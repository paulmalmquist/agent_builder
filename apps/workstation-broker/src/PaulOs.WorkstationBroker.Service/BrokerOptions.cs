namespace PaulOs.WorkstationBroker.Service;

public sealed class BrokerOptions
{
    public const string SectionName = "WorkstationBroker";
    public string Mode { get; init; } = "disabled";
    public Uri? ControlPlaneEndpoint { get; init; }
    public string? ControlPlaneSigningKeyPath { get; init; }
    public string? DeviceCertificateThumbprint { get; init; }
    public string PipePrefix { get; init; } = "paul-os-workstation";
    public bool FixtureMode { get; init; }
    public string FixtureScenario { get; init; } = "resume";
    public string FixtureActorId { get; init; } = "fixture-user";
    public string? FixtureDescriptorPath { get; init; }
    public string? FixtureResultPath { get; init; }
    public int FixtureHandshakeTimeoutSeconds { get; init; } = 30;
}
