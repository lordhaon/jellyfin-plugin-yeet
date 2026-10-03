using System;
using System.Collections.Generic;
using System.Globalization;
using Jellyfin.Plugin.Yeet.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Yeet;

/// <summary>
/// YEET – Your Entertainment, Elsewhere, Televised. Sends an item to another device from the item menu, waking the device first.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// The plugin's unique id. Must match the "guid" in manifest.json.
    /// </summary>
    public const string PluginGuid = "7ee537fa-deb2-43dc-8ba6-7cd0bce1242c";

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Application paths.</param>
    /// <param name="xmlSerializer">XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>
    /// Gets the running plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "YEET - Your Entertainment, Elsewhere, Televised";

    /// <inheritdoc />
    public override string Description => "Adds 'Yeet to device' to the item menu. Turns the device on (a Roku directly, others through Home Assistant), then starts playback there.";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse(PluginGuid);

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = "Yeet",
                EmbeddedResourcePath = string.Format(CultureInfo.InvariantCulture, "{0}.Configuration.configPage.html", GetType().Namespace)
            }
        };
    }
}
