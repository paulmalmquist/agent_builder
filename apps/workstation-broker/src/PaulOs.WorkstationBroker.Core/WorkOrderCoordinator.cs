using System.Security.Cryptography;
using System.Text;
using PaulOs.WorkstationBroker.Contracts;

namespace PaulOs.WorkstationBroker.Core;

public interface IUserProofVerifier
{
    ValueTask<bool> VerifyAsync(
        string actorId,
        string userSid,
        string proofKind,
        string accessToken,
        CancellationToken cancellationToken);
}

public interface IDeviceProofVerifier
{
    ValueTask<bool> VerifyAsync(
        string certificateThumbprint,
        string nonce,
        string signatureBase64Url,
        CancellationToken cancellationToken);
}

public interface IReplayNonceStore
{
    ValueTask<bool> TryConsumeAsync(string nonce, DateTimeOffset expiresAt, CancellationToken cancellationToken);
}

public sealed class InMemoryReplayNonceStore : IReplayNonceStore
{
    private readonly object gate = new();
    private readonly Dictionary<string, DateTimeOffset> values = new(StringComparer.Ordinal);

    public ValueTask<bool> TryConsumeAsync(
        string nonce,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            // Proposal scope is one broker process. Retaining consumed nonces for the
            // process lifetime fails closed even if the local wall clock changes.
            return ValueTask.FromResult(values.TryAdd(nonce, expiresAt));
        }
    }
}

public sealed class WorkOrderCoordinator(
    IUserProofVerifier userProofVerifier,
    IDeviceProofVerifier deviceProofVerifier,
    IReplayNonceStore replayNonceStore)
{
    public async ValueTask<VerifiedDualIdentityBinding> VerifyDualIdentityAsync(
        WorkOrderPayload order,
        DualIdentityHandshake handshake,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(order);
        ArgumentNullException.ThrowIfNull(handshake);
        WorkOrderSignatures.ValidatePayload(order);
        if (now < order.NotBefore || now >= order.ExpiresAt || now >= order.LeaseExpiresAt)
        {
            throw new BrokerInvariantException("The work order or its lease is not currently valid.");
        }
        var exactMatch = handshake.WorkOrderId == order.WorkOrderId
            && handshake.LeaseId == order.LeaseId
            && FixedEquals(handshake.Nonce, order.Nonce)
            && string.Equals(handshake.ActorId, order.RequiredActorId, StringComparison.Ordinal)
            && string.Equals(handshake.UserSid, order.RequiredUserSid, StringComparison.Ordinal)
            && string.Equals(
                PlacementEngine.NormalizeThumbprint(handshake.DeviceCertificateThumbprint),
                PlacementEngine.NormalizeThumbprint(order.RequiredDeviceCertificateThumbprint),
                StringComparison.Ordinal);
        if (!exactMatch)
        {
            throw new BrokerInvariantException(
                "The actor, user, device, work order, lease, and nonce must match exactly.");
        }

        var userVerified = await userProofVerifier.VerifyAsync(
            handshake.ActorId,
            handshake.UserSid,
            handshake.UserProofKind,
            handshake.UserAccessToken,
            cancellationToken);
        var deviceVerified = await deviceProofVerifier.VerifyAsync(
            handshake.DeviceCertificateThumbprint,
            handshake.Nonce,
            handshake.DeviceChallengeSignatureBase64Url,
            cancellationToken);
        if (!userVerified || !deviceVerified)
        {
            throw new BrokerInvariantException("Both current-user and enrolled-device proofs must verify.");
        }
        if (!await replayNonceStore.TryConsumeAsync(order.Nonce, order.ExpiresAt, cancellationToken))
        {
            throw new BrokerInvariantException("The work-order nonce has already been consumed.");
        }

        return new VerifiedDualIdentityBinding(
            order.WorkOrderId,
            order.LeaseId,
            order.Nonce,
            order.RequiredActorId,
            order.RequiredUserSid,
            PlacementEngine.NormalizeThumbprint(order.RequiredDeviceCertificateThumbprint),
            Sha256(handshake.UserAccessToken),
            Sha256(handshake.DeviceChallengeSignatureBase64Url),
            now,
            "control_plane");
    }

    public static RunSnapshot Resume(
        RunSnapshot waiting,
        VerifiedDualIdentityBinding binding,
        DateTimeOffset now)
    {
        if (waiting.State != BrokerRunState.WaitingForUser)
        {
            throw new BrokerInvariantException("Only a waiting_for_user run can resume.");
        }
        if (waiting.ExpiresAt is null || now >= waiting.ExpiresAt)
        {
            throw new BrokerInvariantException("The waiting run expired and cannot perform work.");
        }
        if (binding.WorkOrderId != waiting.WorkOrderId
            || binding.LeaseId != waiting.LeaseId
            || !FixedEquals(binding.Nonce, waiting.Nonce ?? string.Empty)
            || !string.Equals(binding.ActorId, waiting.RequiredActorId, StringComparison.Ordinal)
            || !string.Equals(binding.UserSid, waiting.RequiredUserSid, StringComparison.Ordinal)
            || !string.Equals(
                PlacementEngine.NormalizeThumbprint(binding.DeviceCertificateThumbprint),
                waiting.RequiredDeviceCertificateThumbprint,
                StringComparison.Ordinal))
        {
            throw new BrokerInvariantException("Verified identity does not match the waiting run.");
        }
        return waiting with
        {
            State = BrokerRunState.Leased,
            AttentionRequired = false,
            AttentionReason = null,
            ExternalEffectsAllowed = true,
        };
    }

    private static string Sha256(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static bool FixedEquals(string first, string second) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(first)),
            SHA256.HashData(Encoding.UTF8.GetBytes(second)));
}
