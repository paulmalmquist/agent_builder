using PaulOs.WorkstationBroker.Contracts;
using PaulOs.WorkstationBroker.Core;

namespace PaulOs.WorkstationBroker.Service;

public static class WorkOrderSession
{
    public static async ValueTask<DualIdentityHandshake> BindCurrentDeviceAsync(
        WorkOrderPayload order,
        UserPresenceHandshake user,
        IDeviceIdentityProvider deviceIdentity,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(order);
        ArgumentNullException.ThrowIfNull(user);
        ArgumentNullException.ThrowIfNull(deviceIdentity);
        if (now < order.NotBefore || now >= order.ExpiresAt || now >= order.LeaseExpiresAt)
        {
            throw new BrokerInvariantException("The work order or lease expired before user presence.");
        }
        if (user.WorkOrderId != order.WorkOrderId
            || user.LeaseId != order.LeaseId
            || !string.Equals(user.Nonce, order.Nonce, StringComparison.Ordinal)
            || !string.Equals(user.ActorId, order.RequiredActorId, StringComparison.Ordinal)
            || !string.Equals(user.UserSid, order.RequiredUserSid, StringComparison.Ordinal))
        {
            throw new BrokerInvariantException("User presence does not match the signed work order.");
        }
        var device = await deviceIdentity.SignChallengeAsync(order.Nonce, cancellationToken);
        if (!string.Equals(
                PlacementEngine.NormalizeThumbprint(device.CertificateThumbprint),
                PlacementEngine.NormalizeThumbprint(order.RequiredDeviceCertificateThumbprint),
                StringComparison.Ordinal))
        {
            throw new BrokerInvariantException("The current device does not match the signed work order.");
        }
        return new DualIdentityHandshake(
            user.WorkOrderId,
            user.LeaseId,
            user.Nonce,
            user.ActorId,
            user.UserSid,
            user.UserProofKind,
            user.UserAccessToken,
            device.CertificateThumbprint,
            device.SignatureBase64Url);
    }
}
