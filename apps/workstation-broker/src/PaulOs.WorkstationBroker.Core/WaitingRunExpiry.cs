using PaulOs.WorkstationBroker.Contracts;

namespace PaulOs.WorkstationBroker.Core;

public static class WaitingRunExpiry
{
    public static ExpirationResult Expire(RunSnapshot snapshot, DateTimeOffset now)
    {
        if (snapshot.State == BrokerRunState.Expired)
        {
            return new ExpirationResult(snapshot, null);
        }
        if (snapshot.State != BrokerRunState.WaitingForUser)
        {
            throw new BrokerInvariantException("Only a waiting_for_user run may expire.");
        }
        if (snapshot.ExpiresAt is null || now < snapshot.ExpiresAt)
        {
            throw new BrokerInvariantException("The waiting run has not reached its expiry.");
        }
        var key = $"workstation-expired:{snapshot.RunId:D}";
        var expired = snapshot with
        {
            State = BrokerRunState.Expired,
            AttentionRequired = false,
            AttentionReason = null,
            ExternalEffectsAllowed = false,
            DigestEventKey = key,
        };
        return new ExpirationResult(
            expired,
            new ExpirationDigestItem(
                key,
                snapshot.RunId,
                now,
                "A workstation run expired while waiting for you to sign in.",
                false));
    }
}
