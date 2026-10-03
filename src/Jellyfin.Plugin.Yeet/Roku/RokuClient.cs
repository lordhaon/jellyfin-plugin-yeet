using System;
using System.Globalization;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Yeet.Configuration;
using MediaBrowser.Common.Net;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Yeet.Roku;

/// <summary>
/// Thrown when a Roku can't be reached or rejects a call. The message is safe to show to the user.
/// </summary>
public class RokuException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="RokuException"/> class.
    /// </summary>
    /// <param name="message">Message.</param>
    /// <param name="inner">Inner exception.</param>
    public RokuException(string message, Exception? inner = null)
        : base(message, inner)
    {
    }
}

/// <summary>
/// Talks to a Roku directly over its External Control Protocol (port 8060), without Home Assistant.
/// </summary>
public class RokuClient
{
    /// <summary>
    /// The Jellyfin channel's id in the Roku channel store.
    /// </summary>
    public const string JellyfinChannelId = "592369";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<RokuClient> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="RokuClient"/> class.
    /// </summary>
    /// <param name="httpClientFactory">HTTP client factory.</param>
    /// <param name="logger">Logger.</param>
    public RokuClient(IHttpClientFactory httpClientFactory, ILogger<RokuClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// Turns the Roku on and opens the Jellyfin channel, deep-linking to an item when one is given.
    /// </summary>
    /// <param name="device">Device to launch on.</param>
    /// <param name="itemId">Item to play, or null to only open the channel.</param>
    /// <param name="mediaType">Roku deep link media type, e.g. movie or episode.</param>
    /// <param name="startPositionTicks">Resume position, or 0 to start from the beginning.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public async Task LaunchAsync(YeetDevice device, Guid? itemId, string mediaType, long startPositionTicks, CancellationToken cancellationToken)
    {
        var baseUrl = BaseUrl(device.RokuAddress);
        var channel = string.IsNullOrWhiteSpace(device.RokuChannelId) ? JellyfinChannelId : device.RokuChannelId.Trim();

        // Wakes a Roku TV from standby. Players and sticks ignore it, and a TV that is already on stays on.
        try
        {
            await PostAsync(baseUrl + "/keypress/PowerOn", cancellationToken).ConfigureAwait(false);
        }
        catch (RokuException ex)
        {
            _logger.LogDebug(ex, "[YEET] PowerOn failed for {Device}; launching anyway", device.Name);
        }

        var url = baseUrl + "/launch/" + Uri.EscapeDataString(channel);
        if (itemId is not null)
        {
            url += "?contentId=" + itemId.Value.ToString("N", CultureInfo.InvariantCulture) + "&mediaType=" + Uri.EscapeDataString(mediaType);
            if (startPositionTicks > 0)
            {
                url += "&startPositionTicks=" + startPositionTicks.ToString(CultureInfo.InvariantCulture);
            }
        }

        _logger.LogInformation("[YEET] Launching Jellyfin on {Device} ({Item})", device.Name, itemId);
        await PostAsync(url, cancellationToken).ConfigureAwait(false);
    }

    private static string BaseUrl(string address)
    {
        var host = (address ?? string.Empty).Trim().TrimEnd('/');
        if (host.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            host = host.Substring(7);
        }

        if (host.Length == 0 || Uri.CheckHostName(host.Split(':')[0]) == UriHostNameType.Unknown)
        {
            throw new RokuException("This device's Roku address isn't valid.");
        }

        return "http://" + (host.Contains(':', StringComparison.Ordinal) ? host : host + ":8060");
    }

    private async Task PostAsync(string url, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));

        HttpResponseMessage response;
        try
        {
            response = await _httpClientFactory.CreateClient(NamedClient.Default).SendAsync(request, timeout.Token).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or UriFormatException or InvalidOperationException)
        {
            throw new RokuException("Couldn't reach the Roku. Check its address, and that 'Control by mobile apps' is enabled on it.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new RokuException("The Roku returned an error (" + (int)response.StatusCode + ").");
            }
        }
    }
}
