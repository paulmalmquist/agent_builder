using System.Diagnostics;
using System.Text.Json;
using PaulOs.WorkstationBroker.Contracts;
using Xunit;

namespace PaulOs.WorkstationBroker.Tests;

public sealed class FixtureProcessIntegrationTests
{
    [Theory]
    [InlineData("resume", false)]
    [InlineData("replay", true)]
    public async Task ServiceAndCompanionCompleteExactDualIdentityHandshake(
        string scenario,
        bool replayExpected)
    {
        var run = await RunFixtureAsync(scenario, startCompanion: true);
        Assert.Equal(0, run.ServiceExitCode);
        Assert.Equal(0, run.CompanionExitCode);
        Assert.Equal(
            ["waiting_for_user", "leased", "completed"],
            run.Result.States);
        Assert.True(run.Result.UserProofVerified);
        Assert.True(run.Result.DeviceProofVerified);
        Assert.Equal(replayExpected, run.Result.ReplayRejected);
        Assert.False(run.Result.ExternalEffectsPerformed);
        Assert.Equal("synthetic_fixture_completed", run.Result.Outcome);
        Assert.DoesNotContain("fixture_oidc.", run.ServiceOutput, StringComparison.Ordinal);
        Assert.DoesNotContain("fixture_oidc.", run.CompanionOutput, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ServiceExpiresFixtureWithoutLaunchingCompanionOrPerformingLateEffects()
    {
        var run = await RunFixtureAsync("expiry", startCompanion: false);
        Assert.Equal(0, run.ServiceExitCode);
        Assert.Null(run.CompanionExitCode);
        Assert.Equal(["waiting_for_user", "expired"], run.Result.States);
        Assert.False(run.Result.UserProofVerified);
        Assert.False(run.Result.DeviceProofVerified);
        Assert.False(run.Result.ExternalEffectsPerformed);
        Assert.StartsWith("workstation-expired:", run.Result.DigestEventKey, StringComparison.Ordinal);
        Assert.Equal("expired_without_late_work", run.Result.Outcome);
    }

    private static async Task<FixtureRun> RunFixtureAsync(
        string scenario,
        bool startCompanion)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("The two-process fixture requires Windows.");
        }
        var brokerRoot = FindBrokerRoot(AppContext.BaseDirectory);
        var serviceDll = Path.Combine(
            brokerRoot,
            "src",
            "PaulOs.WorkstationBroker.Service",
            "bin",
            "Release",
            "net10.0-windows10.0.17763.0",
            "PaulOs.WorkstationBroker.Service.dll");
        var companionDll = Path.Combine(
            brokerRoot,
            "src",
            "PaulOs.WorkstationBroker.Companion",
            "bin",
            "Release",
            "net10.0-windows10.0.17763.0",
            "PaulOs.WorkstationBroker.Companion.dll");
        var dotnet = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "dotnet",
            "dotnet.exe");
        Assert.True(File.Exists(serviceDll), $"Service assembly missing: {serviceDll}");
        Assert.True(File.Exists(companionDll), $"Companion assembly missing: {companionDll}");
        Assert.True(File.Exists(dotnet), $"dotnet host missing: {dotnet}");

        var temporaryDirectory = Path.Combine(
            Path.GetTempPath(),
            $"paul-os-broker-fixture-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temporaryDirectory);
        var descriptorPath = Path.Combine(temporaryDirectory, "descriptor.json");
        var resultPath = Path.Combine(temporaryDirectory, "result.json");
        Process? service = null;
        Process? companion = null;
        try
        {
            service = Process.Start(CreateServiceStartInfo(
                dotnet,
                serviceDll,
                scenario,
                descriptorPath,
                resultPath)) ?? throw new InvalidOperationException("Fixture service did not start.");
            await WaitForFileAsync(descriptorPath, TimeSpan.FromSeconds(15));
            if (startCompanion)
            {
                companion = Process.Start(CreateCompanionStartInfo(
                    dotnet,
                    companionDll,
                    descriptorPath)) ?? throw new InvalidOperationException("Fixture companion did not start.");
                await companion.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));
            }
            await WaitForFileAsync(resultPath, TimeSpan.FromSeconds(20));
            await service.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));
            var serviceOutput = await ReadProcessOutputAsync(service);
            var companionOutput = companion is null
                ? string.Empty
                : await ReadProcessOutputAsync(companion);
            await using var resultStream = File.OpenRead(resultPath);
            var result = await JsonSerializer.DeserializeAsync<FixtureDemoResult>(
                    resultStream,
                    BrokerJson.Strict)
                ?? throw new InvalidOperationException("Fixture result is empty.");
            return new FixtureRun(
                service.ExitCode,
                companion?.ExitCode,
                result,
                serviceOutput,
                companionOutput);
        }
        finally
        {
            Terminate(service);
            Terminate(companion);
            Directory.Delete(temporaryDirectory, recursive: true);
        }
    }

    private static ProcessStartInfo CreateServiceStartInfo(
        string dotnet,
        string serviceDll,
        string scenario,
        string descriptorPath,
        string resultPath)
    {
        var start = BaseStartInfo(dotnet);
        start.ArgumentList.Add(serviceDll);
        start.ArgumentList.Add("--WorkstationBroker:Mode=fixture");
        start.ArgumentList.Add("--WorkstationBroker:FixtureMode=true");
        start.ArgumentList.Add($"--WorkstationBroker:FixtureScenario={scenario}");
        start.ArgumentList.Add($"--WorkstationBroker:FixtureDescriptorPath={descriptorPath}");
        start.ArgumentList.Add($"--WorkstationBroker:FixtureResultPath={resultPath}");
        start.ArgumentList.Add("--WorkstationBroker:FixtureHandshakeTimeoutSeconds=15");
        start.Environment["DOTNET_ENVIRONMENT"] = "Development";
        return start;
    }

    private static ProcessStartInfo CreateCompanionStartInfo(
        string dotnet,
        string companionDll,
        string descriptorPath)
    {
        var start = BaseStartInfo(dotnet);
        start.ArgumentList.Add(companionDll);
        start.ArgumentList.Add("--fixture");
        start.ArgumentList.Add("--descriptor");
        start.ArgumentList.Add(descriptorPath);
        start.Environment["DOTNET_ENVIRONMENT"] = "Development";
        return start;
    }

    private static ProcessStartInfo BaseStartInfo(string dotnet) => new()
    {
        FileName = dotnet,
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
    };

    private static async Task WaitForFileAsync(string path, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow.Add(timeout);
        while (!File.Exists(path))
        {
            if (DateTimeOffset.UtcNow >= deadline)
            {
                throw new TimeoutException($"Fixture file was not created: {Path.GetFileName(path)}");
            }
            await Task.Delay(25);
        }
    }

    private static async Task<string> ReadProcessOutputAsync(Process process)
    {
        var standardOutput = await process.StandardOutput.ReadToEndAsync();
        var standardError = await process.StandardError.ReadToEndAsync();
        return $"{standardOutput}\n{standardError}";
    }

    private static void Terminate(Process? process)
    {
        if (process is null) return;
        if (!process.HasExited) process.Kill(entireProcessTree: true);
        process.Dispose();
    }

    private static string FindBrokerRoot(string start)
    {
        var directory = new DirectoryInfo(start);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "PaulOs.WorkstationBroker.slnx")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate the workstation-broker root.");
    }

    private sealed record FixtureRun(
        int ServiceExitCode,
        int? CompanionExitCode,
        FixtureDemoResult Result,
        string ServiceOutput,
        string CompanionOutput);
}
