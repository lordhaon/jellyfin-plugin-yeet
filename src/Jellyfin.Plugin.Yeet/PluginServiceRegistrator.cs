using Jellyfin.Plugin.Yeet.HomeAssistant;
using Jellyfin.Plugin.Yeet.Roku;
using Jellyfin.Plugin.Yeet.Web;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Yeet;

/// <summary>
/// Registers YEET services with Jellyfin's dependency injection.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<HomeAssistantClient>();
        serviceCollection.AddSingleton<RokuClient>();
        serviceCollection.AddTransient<IStartupFilter, YeetStartupFilter>();
    }
}
