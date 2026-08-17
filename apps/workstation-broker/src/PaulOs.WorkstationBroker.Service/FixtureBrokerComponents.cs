using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using PaulOs.WorkstationBroker.Contracts;
using PaulOs.WorkstationBroker.Core;

namespace PaulOs.WorkstationBroker.Service;

public sealed class FixtureWorkOrderTransport : IWorkOrderTransport, IDisposable
{
    private const string Digest =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private readonly BrokerOptions options;
    private readonly EphemeralDevelopmentDeviceIdentityProvider deviceIdentity;
    private readonly RSA signingKey = RSA.Create(2048);
    private bool delivered;

    public FixtureWorkOrderTransport(
        IOptions<BrokerOptions> options,
        EphemeralDevelopmentDeviceIdentityProvider deviceIdentity)
    {
        this.options = options.Value;
        this.deviceIdentity = deviceIdentity;
    }

    public ValueTask<WorkOrderDelivery?> ReceiveAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (delivered) return ValueTask.FromResult<WorkOrderDelivery?>(null);
        delivered = true;
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("The local broker fixture requires Windows.");
        }
        using var currentIdentity = WindowsIdentity.GetCurrent();
        var userSid = currentIdentity.User?.Value
            ?? throw new InvalidOperationException("The current Windows identity has no SID.");
        var now = DateTimeOffset.UtcNow;
        var runId = Guid.NewGuid();
        var pluginVersionId = Guid.NewGuid();
        var installationId = Guid.NewGuid();
        var waiting = PlacementEngine.Place(
            new PlacementRequest(
                runId,
                Guid.NewGuid(),
                null,
                options.FixtureActorId,
                userSid,
                deviceIdentity.Thumbprint,
                Guid.NewGuid(),
                IsDailyBrief: true,
                FreshnessWindowSeconds: null,
                [
                    new PluginRequirement(
                        pluginVersionId,
                        Digest,
                        installationId,
                        "fixture.echo",
                        ExecutionResidency.Workstation),
                ],
                now));
        var order = new WorkOrderPayload(
            "paul-os.workstation-work-order/v1",
            waiting.WorkOrderId!.Value,
            waiting.LeaseId!.Value,
            runId,
            waiting.WorkspaceId,
            null,
            Guid.NewGuid(),
            Digest,
            installationId,
            pluginVersionId,
            Digest,
            "fixture.echo",
            waiting.RequiredActorId,
            waiting.RequiredUserSid,
            waiting.RequiredDeviceCertificateThumbprint,
            now,
            now,
            waiting.ExpiresAt!.Value,
            now.AddMinutes(5),
            waiting.FreshnessWindowSeconds!.Value,
            waiting.Nonce!,
            $"{runId:D}:fixture:0",
            JsonSerializer.SerializeToElement(
                new { message = "synthetic workstation fixture" },
                BrokerJson.Strict));
        var envelope = WorkOrderSignatures.Sign(order, "local-fixture-signing-key", signingKey);
        var publicKey = RSA.Create();
        publicKey.ImportParameters(signingKey.ExportParameters(includePrivateParameters: false));
        return ValueTask.FromResult<WorkOrderDelivery?>(
            new WorkOrderDelivery(envelope, order, waiting, publicKey));
    }

    public ValueTask ReportWaitingAsync(
        FixtureDemoDescriptor descriptor,
        CancellationToken cancellationToken) =>
        WriteJsonAsync(RequiredPath(options.FixtureDescriptorPath, "descriptor"), descriptor, cancellationToken);

    public ValueTask ReportResultAsync(
        FixtureDemoResult result,
        CancellationToken cancellationToken) =>
        WriteJsonAsync(RequiredPath(options.FixtureResultPath, "result"), result, cancellationToken);

    public void Dispose() => signingKey.Dispose();

    private static async ValueTask WriteJsonAsync<T>(
        string path,
        T value,
        CancellationToken cancellationToken)
    {
        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath)
            ?? throw new InvalidOperationException("Fixture output requires a parent directory.");
        Directory.CreateDirectory(directory);
        var temporary = $"{fullPath}.{Guid.NewGuid():N}.tmp";
        await File.WriteAllTextAsync(
            temporary,
            JsonSerializer.Serialize(value, BrokerJson.Strict),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            cancellationToken);
        File.Move(temporary, fullPath, overwrite: true);
    }

    private static string RequiredPath(string? value, string kind) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Fixture {kind} path is required.")
            : value;
}

public sealed class FixtureUserProofVerifier : IUserProofVerifier
{
    public ValueTask<bool> VerifyAsync(
        string actorId,
        string userSid,
        string proofKind,
        string accessToken,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(
            string.Equals(proofKind, "fixture_oidc", StringComparison.Ordinal)
            && FixtureOidcToken.Verify(accessToken, actorId, userSid, DateTimeOffset.UtcNow));
    }
}

public sealed class FixtureDeviceProofVerifier(
    EphemeralDevelopmentDeviceIdentityProvider deviceIdentity) : IDeviceProofVerifier
{
    public ValueTask<bool> VerifyAsync(
        string certificateThumbprint,
        string nonce,
        string signatureBase64Url,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!string.Equals(
                PlacementEngine.NormalizeThumbprint(certificateThumbprint),
                deviceIdentity.Thumbprint,
                StringComparison.Ordinal))
        {
            return ValueTask.FromResult(false);
        }
        try
        {
            using var key = deviceIdentity.PublicKey;
            return ValueTask.FromResult(
                key.VerifyData(
                    Base64Url.Decode(nonce),
                    Base64Url.Decode(signatureBase64Url),
                    HashAlgorithmName.SHA256,
                    RSASignaturePadding.Pkcs1));
        }
        catch (Exception exception) when (exception is FormatException or CryptographicException)
        {
            return ValueTask.FromResult(false);
        }
    }
}

public sealed class RejectingUserProofVerifier : IUserProofVerifier
{
    public ValueTask<bool> VerifyAsync(
        string actorId,
        string userSid,
        string proofKind,
        string accessToken,
        CancellationToken cancellationToken) => ValueTask.FromResult(false);
}

public sealed class RejectingDeviceProofVerifier : IDeviceProofVerifier
{
    public ValueTask<bool> VerifyAsync(
        string certificateThumbprint,
        string nonce,
        string signatureBase64Url,
        CancellationToken cancellationToken) => ValueTask.FromResult(false);
}

public sealed class FixtureNoEffectPluginExecutor : ILocalPluginExecutor
{
    public ValueTask<LocalPluginExecutionReceipt> ExecuteAsync(
        WorkOrderPayload order,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!string.Equals(order.Tool, "fixture.echo", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The local fixture executor accepts only fixture.echo.");
        }
        var digest = Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes(order.InvocationKey)));
        return ValueTask.FromResult(new LocalPluginExecutionReceipt(digest, false));
    }
}
