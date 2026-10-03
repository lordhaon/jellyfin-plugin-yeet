using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Yeet.Configuration;
using MediaBrowser.Common.Net;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Yeet.HomeAssistant;

/// <summary>
/// Thrown when Home Assistant can't be reached or rejects a call. The message is safe to show to the user.
/// </summary>
public class HomeAssistantException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="HomeAssistantException"/> class.
    /// </summary>
    /// <param name="message">Message.</param>
    /// <param name="inner">Inner exception.</param>
    public HomeAssistantException(string message, Exception? inner = null)
        : base(message, inner)
    {
    }
}

/// <summary>
/// Calls Home Assistant services to turn a device on and open the Jellyfin app on it.
/// </summary>
public class HomeAssistantClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<HomeAssistantClient> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="HomeAssistantClient"/> class.
    /// </summary>
    /// <param name="httpClientFactory">HTTP client factory.</param>
    /// <param name="logger">Logger.</param>
    public HomeAssistantClient(IHttpClientFactory httpClientFactory, ILogger<HomeAssistantClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <summary>
    /// Wakes a device. What is called depends on the entity's domain.
    /// </summary>
    /// <param name="config">Plugin configuration.</param>
    /// <param name="device">Device to wake.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task.</returns>
    public async Task WakeAsync(PluginConfiguration config, YeetDevice device, CancellationToken cancellationToken)
    {
        var entity = (device.HaEntityId ?? string.Empty).Trim();
        var dot = entity.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0)
        {
            throw new HomeAssistantException("This device has no Home Assistant entity set.");
        }

        if (string.IsNullOrWhiteSpace(config.HomeAssistantUrl) || string.IsNullOrWhiteSpace(config.HomeAssistantToken))
        {
            throw new HomeAssistantException("Home Assistant isn't set up in the YEET settings.");
        }

        var domain = entity.Substring(0, dot);
        _logger.LogInformation("[YEET] Waking {Device} through {Entity}", device.Name, entity);

        switch (domain)
        {
            case "media_player":
                // A set-top box that is already on may reject turn_on; launching the app is what matters.
                try
                {
                    await CallServiceAsync(config, "media_player", "turn_on", entity, null, cancellationToken).ConfigureAwait(false);
                }
                catch (HomeAssistantException ex)
                {
                    _logger.LogDebug(ex, "[YEET] turn_on failed for {Entity}; launching the app anyway", entity);
                }

                var source = string.IsNullOrWhiteSpace(device.AppSource) ? "Jellyfin" : device.AppSource.Trim();
                await CallServiceAsync(config, "media_player", "select_source", entity, source, cancellationToken).ConfigureAwait(false);
                break;
            case "button":
            case "input_button":
                await CallServiceAsync(config, domain, "press", entity, null, cancellationToken).ConfigureAwait(false);
                break;
            case "script":
            case "scene":
                await CallServiceAsync(config, domain, "turn_on", entity, null, cancellationToken).ConfigureAwait(false);
                break;
            default:
                await CallServiceAsync(config, "homeassistant", "turn_on", entity, null, cancellationToken).ConfigureAwait(false);
                break;
        }
    }

    private async Task CallServiceAsync(PluginConfiguration config, string domain, string service, string entity, string? source, CancellationToken cancellationToken)
    {
        var url = config.HomeAssistantUrl.Trim().TrimEnd('/') + "/api/services/" + domain + "/" + service;
        var body = new Dictionary<string, string> { ["entity_id"] = entity };
        if (source is not null)
        {
            body["source"] = source;
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.HomeAssistantToken.Trim());

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));

        HttpResponseMessage response;
        try
        {
            response = await _httpClientFactory.CreateClient(NamedClient.Default).SendAsync(request, timeout.Token).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or UriFormatException or InvalidOperationException)
        {
            throw new HomeAssistantException("Couldn't reach Home Assistant.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                throw new HomeAssistantException(status == 401
                    ? "Home Assistant rejected the access token."
                    : "Home Assistant returned an error (" + status + ") for " + domain + "." + service + ".");
            }
        }
    }
}
