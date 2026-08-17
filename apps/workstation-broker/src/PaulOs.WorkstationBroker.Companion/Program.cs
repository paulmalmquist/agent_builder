using System.Security.Principal;
using System.Text.Json;
using PaulOs.WorkstationBroker.Companion;
using PaulOs.WorkstationBroker.Contracts;
using PaulOs.WorkstationBroker.Core;

try
{
    var fixture = args.Contains("--fixture", StringComparer.Ordinal);
    var wam = args.Contains("--wam", StringComparer.Ordinal);
    if (fixture == wam)
    {
        throw new InvalidOperationException("Choose exactly one identity mode: --fixture or --wam.");
    }
    if (fixture && !string.Equals(
            Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"),
            "Development",
            StringComparison.Ordinal))
    {
        throw new InvalidOperationException("Fixture identity is permitted only in Development.");
    }
    var descriptorPath = RequiredArgument(args, "--descriptor");
    var descriptor = await WaitForDescriptorAsync(descriptorPath, TimeSpan.FromSeconds(30));
    if (!string.Equals(
            descriptor.SchemaVersion,
            "paul-os.fixture-descriptor/v1",
            StringComparison.Ordinal))
    {
        throw new InvalidOperationException("Unsupported work-order descriptor version.");
    }
    if (!OperatingSystem.IsWindows())
    {
        throw new PlatformNotSupportedException("The workstation companion requires Windows.");
    }
    using var currentIdentity = WindowsIdentity.GetCurrent();
    var currentSid = currentIdentity.User?.Value
        ?? throw new InvalidOperationException("The current Windows identity has no SID.");
    if (!string.Equals(currentSid, descriptor.RequiredUserSid, StringComparison.Ordinal))
    {
        throw new InvalidOperationException("This work order belongs to a different Windows user.");
    }

    string token;
    string proofKind;
    if (fixture)
    {
        token = FixtureOidcToken.Issue(
            descriptor.RequiredActorId,
            currentSid,
            DateTimeOffset.UtcNow.AddMinutes(5));
        proofKind = "fixture_oidc";
    }
    else
    {
        var scopes = RequiredArgument(args, "--scopes")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var provider = new WamUserTokenProvider(
            RequiredArgument(args, "--client-id"),
            RequiredArgument(args, "--authority"),
            scopes);
        token = await provider.AcquireAsync(CancellationToken.None);
        proofKind = "entra_wam";
    }

    await NamedPipeHandshakeClient.SendAsync(
        descriptor.PipeName,
        new UserPresenceHandshake(
            descriptor.WorkOrderId,
            descriptor.LeaseId,
            descriptor.Nonce,
            descriptor.RequiredActorId,
            currentSid,
            proofKind,
            token),
        CancellationToken.None);
    Console.WriteLine(
        JsonSerializer.Serialize(
            new { status = "handshake_sent", workOrderId = descriptor.WorkOrderId },
            BrokerJson.Strict));
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Workstation companion failed closed: {exception.Message}");
    return 3;
}

static string RequiredArgument(string[] arguments, string name)
{
    var index = Array.IndexOf(arguments, name);
    if (index < 0 || index + 1 >= arguments.Length || string.IsNullOrWhiteSpace(arguments[index + 1]))
    {
        throw new InvalidOperationException($"Required argument {name} is missing.");
    }
    return arguments[index + 1];
}

static async ValueTask<FixtureDemoDescriptor> WaitForDescriptorAsync(
    string path,
    TimeSpan timeout)
{
    var fullPath = Path.GetFullPath(path);
    var deadline = DateTimeOffset.UtcNow.Add(timeout);
    while (!File.Exists(fullPath))
    {
        if (DateTimeOffset.UtcNow >= deadline)
        {
            throw new TimeoutException("The signed work-order descriptor was not published in time.");
        }
        await Task.Delay(50);
    }
    await using var stream = File.OpenRead(fullPath);
    return await JsonSerializer.DeserializeAsync<FixtureDemoDescriptor>(stream, BrokerJson.Strict)
        ?? throw new InvalidOperationException("The work-order descriptor is empty.");
}
