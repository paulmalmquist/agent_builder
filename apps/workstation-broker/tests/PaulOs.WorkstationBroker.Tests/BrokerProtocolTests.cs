using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using PaulOs.WorkstationBroker.Contracts;
using PaulOs.WorkstationBroker.Core;
using PaulOs.WorkstationBroker.Service;
using Xunit;

namespace PaulOs.WorkstationBroker.Tests;

public sealed class BrokerProtocolTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 17, 11, 0, 0, TimeSpan.Zero);
    private const string Actor = "local-user";
    private const string Sid = "S-1-5-21-100-200-300-1001";
    private const string Thumbprint = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private const string Digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    [Fact]
    public void CentralOnlyRunsRemainReadyWithoutAttention()
    {
        var state = PlacementEngine.Place(Request(ExecutionResidency.ControlPlane));
        Assert.Equal(BrokerRunState.ControlPlaneReady, state.State);
        Assert.Equal(ExecutionResidency.ControlPlane, state.Placement);
        Assert.True(state.ExternalEffectsAllowed);
        Assert.False(state.AttentionRequired);
        Assert.Null(state.WorkOrderId);
    }

    [Fact]
    public void AnyWorkstationRequirementHoldsTheWholeRunWithoutFallback()
    {
        var request = Request(
            ExecutionResidency.ControlPlane,
            ExecutionResidency.Workstation);
        var state = PlacementEngine.Place(request);
        Assert.Equal(BrokerRunState.WaitingForUser, state.State);
        Assert.Equal(ExecutionResidency.Workstation, state.Placement);
        Assert.Equal("Waiting for you to sign in.", state.AttentionReason);
        Assert.False(state.ExternalEffectsAllowed);
        Assert.Equal(PlacementEngine.DailyBriefFreshnessWindowSeconds, state.FreshnessWindowSeconds);
        Assert.Equal(Now.AddSeconds(7_200), state.ExpiresAt);
    }

    [Fact]
    public void OtherScheduledWorkstationRunsMustDeclareFreshness()
    {
        var request = Request(ExecutionResidency.Workstation) with
        {
            IsDailyBrief = false,
            FreshnessWindowSeconds = null,
        };
        var error = Assert.Throws<BrokerInvariantException>(() => PlacementEngine.Place(request));
        Assert.Contains("requires FreshnessWindowSeconds", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void SignedOrdersRejectPayloadTampering()
    {
        using var key = RSA.Create(2048);
        var order = Order(PlacementEngine.Place(Request(ExecutionResidency.Workstation)));
        var envelope = WorkOrderSignatures.Sign(order, "fixture-signing-key", key);
        var verified = WorkOrderSignatures.VerifyAndRead(envelope, key);
        Assert.Equal(order.WorkOrderId, verified.WorkOrderId);
        Assert.Equal(order.ReleaseDigest, verified.ReleaseDigest);
        Assert.Equal(order.Input.GetRawText(), verified.Input.GetRawText());
        var tamperedPayload = Base64Url.Encode(
            Encoding.UTF8.GetBytes(
                Encoding.UTF8.GetString(Base64Url.Decode(envelope.PayloadBase64Url)) + " "));
        Assert.Throws<BrokerInvariantException>(
            () => WorkOrderSignatures.VerifyAndRead(envelope with { PayloadBase64Url = tamperedPayload }, key));
    }

    [Fact]
    public async Task ResumeRequiresExactUserAndDeviceAndConsumesNonceOnce()
    {
        var state = PlacementEngine.Place(Request(ExecutionResidency.Workstation));
        var order = Order(state);
        var coordinator = new WorkOrderCoordinator(
            new AcceptingUserVerifier(),
            new AcceptingDeviceVerifier(),
            new InMemoryReplayNonceStore());
        var handshake = Handshake(order);
        var binding = await coordinator.VerifyDualIdentityAsync(
            order,
            handshake,
            Now.AddMinutes(1));
        var resumed = WorkOrderCoordinator.Resume(state, binding, Now.AddMinutes(1));
        Assert.Equal(BrokerRunState.Leased, resumed.State);
        Assert.True(resumed.ExternalEffectsAllowed);
        Assert.False(resumed.AttentionRequired);

        var replay = await Assert.ThrowsAsync<BrokerInvariantException>(async () =>
            await coordinator.VerifyDualIdentityAsync(order, handshake, Now.AddMinutes(2)));
        Assert.Contains("already been consumed", replay.Message, StringComparison.Ordinal);

        var mismatched = handshake with { ActorId = "different-user" };
        var mismatchError = await Assert.ThrowsAsync<BrokerInvariantException>(async () =>
            await new WorkOrderCoordinator(
                    new AcceptingUserVerifier(),
                    new AcceptingDeviceVerifier(),
                    new InMemoryReplayNonceStore())
                .VerifyDualIdentityAsync(order, mismatched, Now.AddMinutes(1)));
        Assert.Contains("must match exactly", mismatchError.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UserOnlyOrDeviceOnlyProofFailsClosed()
    {
        var order = Order(PlacementEngine.Place(Request(ExecutionResidency.Workstation)));
        var handshake = Handshake(order);
        var userOnly = new WorkOrderCoordinator(
            new AcceptingUserVerifier(),
            new RejectingDeviceVerifier(),
            new InMemoryReplayNonceStore());
        await Assert.ThrowsAsync<BrokerInvariantException>(async () =>
            await userOnly.VerifyDualIdentityAsync(order, handshake, Now.AddMinutes(1)));

        var deviceOnly = new WorkOrderCoordinator(
            new RejectingUserVerifier(),
            new AcceptingDeviceVerifier(),
            new InMemoryReplayNonceStore());
        await Assert.ThrowsAsync<BrokerInvariantException>(async () =>
            await deviceOnly.VerifyDualIdentityAsync(order, handshake, Now.AddMinutes(1)));
    }

    [Fact]
    public void ExpiryCancelsLateWorkAndEmitsOneDigestItem()
    {
        var waiting = PlacementEngine.Place(Request(ExecutionResidency.Workstation));
        var first = WaitingRunExpiry.Expire(waiting, Now.AddHours(2));
        Assert.Equal(BrokerRunState.Expired, first.Snapshot.State);
        Assert.False(first.Snapshot.ExternalEffectsAllowed);
        Assert.False(first.DigestItem?.LateEffectsPerformed);
        Assert.Equal($"workstation-expired:{waiting.RunId:D}", first.DigestItem?.IdempotencyKey);
        var retry = WaitingRunExpiry.Expire(first.Snapshot, Now.AddHours(3));
        Assert.Null(retry.DigestItem);
        Assert.Throws<BrokerInvariantException>(
            () => WorkOrderCoordinator.Resume(
                first.Snapshot,
                new VerifiedDualIdentityBinding(
                    waiting.WorkOrderId!.Value,
                    waiting.LeaseId!.Value,
                    waiting.Nonce!,
                    Actor,
                    Sid,
                    Thumbprint,
                    Digest,
                    Digest,
                    Now.AddMinutes(1),
                    "fixture"),
                Now.AddHours(2)));
    }

    [Fact]
    public async Task DevelopmentDeviceCertificateSignsTheExactNonce()
    {
        using var provider = new EphemeralDevelopmentDeviceIdentityProvider();
        var nonce = Base64Url.Encode(RandomNumberGenerator.GetBytes(32));
        var proof = await provider.SignChallengeAsync(nonce, CancellationToken.None);
        Assert.Equal(provider.Thumbprint, proof.CertificateThumbprint);
        Assert.True(provider.PublicKey.VerifyData(
            Base64Url.Decode(nonce),
            Base64Url.Decode(proof.SignatureBase64Url),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1));
    }

    [Fact]
    public async Task UserPresenceIsBoundToTheCurrentDeviceBeforeItBecomesDualIdentity()
    {
        using var provider = new EphemeralDevelopmentDeviceIdentityProvider();
        var request = Request(ExecutionResidency.Workstation) with
        {
            RequiredDeviceCertificateThumbprint = provider.Thumbprint,
        };
        var state = PlacementEngine.Place(request);
        var order = Order(state);
        var user = new UserPresenceHandshake(
            order.WorkOrderId,
            order.LeaseId,
            order.Nonce,
            order.RequiredActorId,
            order.RequiredUserSid,
            "fixture_oidc",
            "fixture_oidc.payload.signature-that-is-not-logged");
        var combined = await WorkOrderSession.BindCurrentDeviceAsync(
            order,
            user,
            provider,
            Now.AddMinutes(1),
            CancellationToken.None);
        Assert.Equal(provider.Thumbprint, combined.DeviceCertificateThumbprint);
        Assert.False(string.IsNullOrWhiteSpace(combined.DeviceChallengeSignatureBase64Url));

        await Assert.ThrowsAsync<BrokerInvariantException>(async () =>
            await WorkOrderSession.BindCurrentDeviceAsync(
                order,
                user with { ActorId = "different-user" },
                provider,
                Now.AddMinutes(1),
                CancellationToken.None));
    }

    [Fact]
    public async Task FixtureTokensAreBoundToActorSidAndExpiryAndRejectTampering()
    {
        var token = FixtureOidcToken.Issue(Actor, Sid, Now.AddMinutes(5));
        Assert.True(FixtureOidcToken.Verify(token, Actor, Sid, Now));
        Assert.False(FixtureOidcToken.Verify(token, "different-user", Sid, Now));
        Assert.False(FixtureOidcToken.Verify(token, Actor, "S-1-5-21-9-9-9-9", Now));
        Assert.False(FixtureOidcToken.Verify(token, Actor, Sid, Now.AddMinutes(5)));
        Assert.False(FixtureOidcToken.Verify($"{token}x", Actor, Sid, Now));

        var productionTransport = new FailClosedWorkOrderTransport(
            Options.Create(new BrokerOptions { Mode = "production" }));
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            await productionTransport.ReceiveAsync(CancellationToken.None));
        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
            await new UnconfiguredLocalPluginExecutor().ExecuteAsync(
                Order(PlacementEngine.Place(Request(ExecutionResidency.Workstation))),
                CancellationToken.None));
    }

    [Fact]
    public async Task NamedPipeAclAllowsOnlyCurrentUserAndLocalSystem()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }
        using var identity = WindowsIdentity.GetCurrent();
        var currentSid = identity.User?.Value
            ?? throw new InvalidOperationException("The current Windows user has no SID.");
        var pipeName = $"paul-os-broker-test-{Guid.NewGuid():N}";
        await using var server = SecureNamedPipeFactory.Create(pipeName, currentSid);
        var connectTask = Task.Run(async () =>
        {
            await using var client = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.Out,
                PipeOptions.Asynchronous);
            await client.ConnectAsync(5_000);
            await client.WriteAsync(new byte[] { 0x2A });
        });
        await server.WaitForConnectionAsync();
        var value = server.ReadByte();
        await connectTask;
        Assert.Equal(0x2A, value);

        var security = server.GetAccessControl();
        var rules = security.GetAccessRules(includeExplicit: true, includeInherited: false, typeof(SecurityIdentifier));
        var allowed = rules.Cast<PipeAccessRule>()
            .Where(rule => rule.AccessControlType == System.Security.AccessControl.AccessControlType.Allow)
            .Select(rule => rule.IdentityReference.Value)
            .ToHashSet(StringComparer.Ordinal);
        Assert.Contains(currentSid, allowed);
        Assert.Contains(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null).Value, allowed);
        Assert.Equal(2, allowed.Count);
    }

    private static PlacementRequest Request(params ExecutionResidency[] residency) =>
        new(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            Actor,
            Sid,
            Thumbprint,
            Guid.NewGuid(),
            IsDailyBrief: true,
            FreshnessWindowSeconds: null,
            residency.Select(
                placement => new PluginRequirement(
                    Guid.NewGuid(),
                    Digest,
                    Guid.NewGuid(),
                    "local-file.read",
                    placement)).ToArray(),
            Now);

    private static WorkOrderPayload Order(RunSnapshot state) =>
        new(
            "paul-os.workstation-work-order/v1",
            state.WorkOrderId!.Value,
            state.LeaseId!.Value,
            state.RunId,
            state.WorkspaceId,
            state.DepartmentId,
            Guid.NewGuid(),
            Digest,
            Guid.NewGuid(),
            Guid.NewGuid(),
            Digest,
            "local-file.read",
            state.RequiredActorId,
            state.RequiredUserSid,
            state.RequiredDeviceCertificateThumbprint,
            Now,
            Now,
            Now.AddHours(2),
            Now.AddMinutes(10),
            PlacementEngine.DailyBriefFreshnessWindowSeconds,
            state.Nonce!,
            $"{state.RunId:D}:plugin:0",
            JsonSerializer.SerializeToElement(new { relativePath = "briefing-input.json" }));

    private static DualIdentityHandshake Handshake(WorkOrderPayload order) =>
        new(
            order.WorkOrderId,
            order.LeaseId,
            order.Nonce,
            order.RequiredActorId,
            order.RequiredUserSid,
            "fixture_oidc",
            "fixture_oidc.payload.signature-that-is-not-logged",
            order.RequiredDeviceCertificateThumbprint,
            Base64Url.Encode(RandomNumberGenerator.GetBytes(256)));

    private sealed class AcceptingUserVerifier : IUserProofVerifier
    {
        public ValueTask<bool> VerifyAsync(
            string actorId,
            string userSid,
            string proofKind,
            string accessToken,
            CancellationToken cancellationToken) => ValueTask.FromResult(true);
    }

    private sealed class RejectingUserVerifier : IUserProofVerifier
    {
        public ValueTask<bool> VerifyAsync(
            string actorId,
            string userSid,
            string proofKind,
            string accessToken,
            CancellationToken cancellationToken) => ValueTask.FromResult(false);
    }

    private sealed class AcceptingDeviceVerifier : IDeviceProofVerifier
    {
        public ValueTask<bool> VerifyAsync(
            string certificateThumbprint,
            string nonce,
            string signatureBase64Url,
            CancellationToken cancellationToken) => ValueTask.FromResult(true);
    }

    private sealed class RejectingDeviceVerifier : IDeviceProofVerifier
    {
        public ValueTask<bool> VerifyAsync(
            string certificateThumbprint,
            string nonce,
            string signatureBase64Url,
            CancellationToken cancellationToken) => ValueTask.FromResult(false);
    }
}
