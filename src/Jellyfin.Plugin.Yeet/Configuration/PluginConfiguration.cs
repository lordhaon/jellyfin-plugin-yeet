using System;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Yeet.Configuration;

/// <summary>
/// YEET settings, editable from Dashboard → Plugins → YEET.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the Home Assistant base URL, e.g. http://192.168.2.10:8123.
    /// </summary>
    public string HomeAssistantUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a Home Assistant long-lived access token.
    /// </summary>
    public string HomeAssistantToken { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the devices that can be turned on and played to.
    /// </summary>
    public YeetDevice[] Devices { get; set; } = Array.Empty<YeetDevice>();
}

/// <summary>
/// A device that "Yeet to device" can turn on.
/// </summary>
public class YeetDevice
{
    /// <summary>
    /// Gets or sets a stable id for the device.
    /// </summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the name shown in the picker.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets text that the Jellyfin session's device name contains, used to find the device once its app is open.
    /// Falls back to <see cref="Name"/> when empty.
    /// </summary>
    public string SessionMatch { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Roku's IP address or host name. When set, the device is launched directly and Home Assistant isn't used.
    /// </summary>
    public string RokuAddress { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Roku channel to launch.
    /// </summary>
    public string RokuChannelId { get; set; } = "592369";

    /// <summary>
    /// Gets or sets the Home Assistant entity that wakes the device: a media_player, script, scene or button.
    /// </summary>
    public string HaEntityId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the app to launch on a media_player entity.
    /// </summary>
    public string AppSource { get; set; } = "Jellyfin";
}
