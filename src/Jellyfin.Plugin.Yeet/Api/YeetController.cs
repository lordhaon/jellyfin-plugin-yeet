using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Mime;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Yeet.HomeAssistant;
using Jellyfin.Plugin.Yeet.Roku;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Yeet.Api;

/// <summary>
/// A configured device, as shown in the picker. Never includes Home Assistant details.
/// </summary>
public class DeviceDto
{
    /// <summary>
    /// Gets or sets the device id.
    /// </summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the text the Jellyfin session's device name contains.
    /// </summary>
    [JsonPropertyName("sessionMatch")]
    public string SessionMatch { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the device can be turned on, directly or through Home Assistant.
    /// </summary>
    [JsonPropertyName("canWake")]
    public bool CanWake { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the device is a Roku that is launched straight into the item.
    /// </summary>
    [JsonPropertyName("direct")]
    public bool Direct { get; set; }
}

/// <summary>
/// An error message for the picker.
/// </summary>
public class ErrorDto
{
    /// <summary>
    /// Gets or sets the message.
    /// </summary>
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;
}

/// <summary>
/// YEET API. Available to every signed-in user; playback itself goes through Jellyfin's own remote control API.
/// </summary>
[ApiController]
[Route("Yeet")]
[Authorize]
[Produces(MediaTypeNames.Application.Json)]
public class YeetController : ControllerBase
{
    private static readonly string[] MediaTypes = { "movie", "episode", "series", "season", "audio" };

    private readonly HomeAssistantClient _homeAssistant;
    private readonly RokuClient _roku;

    /// <summary>
    /// Initializes a new instance of the <see cref="YeetController"/> class.
    /// </summary>
    /// <param name="homeAssistant">Home Assistant client.</param>
    /// <param name="roku">Roku client.</param>
    public YeetController(HomeAssistantClient homeAssistant, RokuClient roku)
    {
        _homeAssistant = homeAssistant;
        _roku = roku;
    }

    /// <summary>
    /// Lists the configured devices.
    /// </summary>
    /// <returns>Devices.</returns>
    [HttpGet("Devices")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<IReadOnlyList<DeviceDto>> GetDevices()
    {
        var config = Plugin.Instance?.Configuration;
        if (config is null)
        {
            return Ok(Array.Empty<DeviceDto>());
        }

        var haReady = !string.IsNullOrWhiteSpace(config.HomeAssistantUrl) && !string.IsNullOrWhiteSpace(config.HomeAssistantToken);
        return Ok(config.Devices
            .Where(d => !string.IsNullOrWhiteSpace(d.Id) && !string.IsNullOrWhiteSpace(d.Name))
            .Select(d => new DeviceDto
            {
                Id = d.Id,
                Name = d.Name,
                SessionMatch = string.IsNullOrWhiteSpace(d.SessionMatch) ? d.Name : d.SessionMatch,
                CanWake = !string.IsNullOrWhiteSpace(d.RokuAddress) || (haReady && !string.IsNullOrWhiteSpace(d.HaEntityId)),
                Direct = !string.IsNullOrWhiteSpace(d.RokuAddress)
            })
            .ToList());
    }

    /// <summary>
    /// Turns a device on and opens the Jellyfin app on it: directly for a Roku, otherwise through Home Assistant.
    /// </summary>
    /// <param name="deviceId">Device id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>No content, or an error message.</returns>
    [HttpPost("Devices/{deviceId}/Wake")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    public async Task<ActionResult> Wake([FromRoute] string deviceId, CancellationToken cancellationToken)
    {
        var config = Plugin.Instance?.Configuration;
        var device = config?.Devices.FirstOrDefault(d => string.Equals(d.Id, deviceId, StringComparison.OrdinalIgnoreCase));
        if (config is null || device is null)
        {
            return NotFound(new ErrorDto { Message = "That device is no longer in the YEET settings." });
        }

        try
        {
            if (!string.IsNullOrWhiteSpace(device.RokuAddress))
            {
                await _roku.LaunchAsync(device, null, string.Empty, 0, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await _homeAssistant.WakeAsync(config, device, cancellationToken).ConfigureAwait(false);
            }

            return NoContent();
        }
        catch (Exception ex) when (ex is HomeAssistantException or RokuException)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new ErrorDto { Message = ex.Message });
        }
    }

    /// <summary>
    /// Turns a Roku on and starts an item on it in one step, using the Jellyfin channel's deep link.
    /// </summary>
    /// <param name="deviceId">Device id.</param>
    /// <param name="itemId">Item to play.</param>
    /// <param name="mediaType">Roku media type: movie, episode, series, season or audio.</param>
    /// <param name="startPositionTicks">Resume position.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>No content, or an error message.</returns>
    [HttpPost("Devices/{deviceId}/Launch")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    public async Task<ActionResult> Launch(
        [FromRoute] string deviceId,
        [FromQuery] Guid itemId,
        [FromQuery] string? mediaType,
        [FromQuery] long? startPositionTicks,
        CancellationToken cancellationToken)
    {
        var device = Plugin.Instance?.Configuration.Devices.FirstOrDefault(d => string.Equals(d.Id, deviceId, StringComparison.OrdinalIgnoreCase));
        if (device is null)
        {
            return NotFound(new ErrorDto { Message = "That device is no longer in the YEET settings." });
        }

        if (string.IsNullOrWhiteSpace(device.RokuAddress) || itemId == Guid.Empty)
        {
            return BadRequest(new ErrorDto { Message = "This device can't be launched directly." });
        }

        var type = MediaTypes.FirstOrDefault(t => string.Equals(t, mediaType, StringComparison.OrdinalIgnoreCase)) ?? "movie";
        try
        {
            await _roku.LaunchAsync(device, itemId, type, Math.Max(0, startPositionTicks ?? 0), cancellationToken).ConfigureAwait(false);
            return NoContent();
        }
        catch (RokuException ex)
        {
            return StatusCode(StatusCodes.Status502BadGateway, new ErrorDto { Message = ex.Message });
        }
    }
}
