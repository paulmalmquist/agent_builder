using Microsoft.Extensions.Options;
using PaulOs.WorkstationBroker.Core;
using PaulOs.WorkstationBroker.Service;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "Paul OS Workstation Broker");
builder.Services.AddOptions<BrokerOptions>()
    .Bind(builder.Configuration.GetSection(BrokerOptions.SectionName))
    .Validate(
        options => !options.FixtureMode || builder.Environment.IsDevelopment(),
        "Fixture mode is permitted only in the Development environment.")
    .Validate(
        options => !options.FixtureMode
            || (string.Equals(options.Mode, "fixture", StringComparison.OrdinalIgnoreCase)
                && options.FixtureScenario is "resume" or "replay" or "expiry"
                && !string.IsNullOrWhiteSpace(options.FixtureDescriptorPath)
                && !string.IsNullOrWhiteSpace(options.FixtureResultPath)
                && options.FixtureHandshakeTimeoutSeconds is >= 2 and <= 120),
        "Fixture mode requires fixture transport, bounded paths, a known scenario, and a bounded timeout.")
    .Validate(
        options => !string.Equals(options.Mode, "production", StringComparison.OrdinalIgnoreCase)
            || (!options.FixtureMode
                && options.ControlPlaneEndpoint is { Scheme: "https" }
                && !string.IsNullOrWhiteSpace(options.ControlPlaneSigningKeyPath)
                && !string.IsNullOrWhiteSpace(options.DeviceCertificateThumbprint)),
        "Production mode requires HTTPS control-plane transport, a pinned signing key, and a device certificate.")
    .ValidateOnStart();
var fixtureMode = builder.Configuration.GetValue<bool>($"{BrokerOptions.SectionName}:FixtureMode");
if (fixtureMode)
{
    builder.Services.AddSingleton<EphemeralDevelopmentDeviceIdentityProvider>();
    builder.Services.AddSingleton<IDeviceIdentityProvider>(
        services => services.GetRequiredService<EphemeralDevelopmentDeviceIdentityProvider>());
    builder.Services.AddSingleton<IWorkOrderTransport, FixtureWorkOrderTransport>();
    builder.Services.AddSingleton<IUserProofVerifier, FixtureUserProofVerifier>();
    builder.Services.AddSingleton<IDeviceProofVerifier, FixtureDeviceProofVerifier>();
    builder.Services.AddSingleton<ILocalPluginExecutor, FixtureNoEffectPluginExecutor>();
}
else
{
    builder.Services.AddSingleton<IDeviceIdentityProvider, WindowsCertificateStoreDeviceIdentityProvider>();
    builder.Services.AddSingleton<IWorkOrderTransport, FailClosedWorkOrderTransport>();
    builder.Services.AddSingleton<IUserProofVerifier, RejectingUserProofVerifier>();
    builder.Services.AddSingleton<IDeviceProofVerifier, RejectingDeviceProofVerifier>();
    builder.Services.AddSingleton<ILocalPluginExecutor, UnconfiguredLocalPluginExecutor>();
}
builder.Services.AddSingleton<IReplayNonceStore, InMemoryReplayNonceStore>();
builder.Services.AddSingleton<WorkOrderCoordinator>();
builder.Services.AddSingleton<BrokerSessionRunner>();
builder.Services.AddHostedService<BrokerWorker>();
await builder.Build().RunAsync();
