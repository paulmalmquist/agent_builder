using System.Security.Cryptography;
using PaulOs.WorkstationBroker.Contracts;

namespace PaulOs.WorkstationBroker.Core;

public static class PlacementEngine
{
    public const int DailyBriefFreshnessWindowSeconds = 7_200;
    public const int DefaultAdHocFreshnessWindowSeconds = 3_600;

    public static RunSnapshot Place(
        PlacementRequest request,
        Guid? workOrderId = null,
        Guid? leaseId = null,
        string? nonce = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        var workstationRequired = request.Requirements.Any(
            requirement => requirement.Residency == ExecutionResidency.Workstation);
        if (!workstationRequired)
        {
            return new RunSnapshot(
                request.RunId,
                request.WorkspaceId,
                request.DepartmentId,
                request.ScheduleId,
                BrokerRunState.ControlPlaneReady,
                ExecutionResidency.ControlPlane,
                request.ActorId,
                request.RequiredUserSid,
                NormalizeThumbprint(request.RequiredDeviceCertificateThumbprint),
                null,
                null,
                null,
                null,
                null,
                null,
                false,
                null,
                true,
                null);
        }

        if (request.ScheduleId is not null && !request.IsDailyBrief && request.FreshnessWindowSeconds is null)
        {
            throw new BrokerInvariantException(
                "A workstation-dependent schedule requires FreshnessWindowSeconds.");
        }

        var freshness = request.FreshnessWindowSeconds
            ?? (request.IsDailyBrief
                ? DailyBriefFreshnessWindowSeconds
                : DefaultAdHocFreshnessWindowSeconds);
        if (freshness is < 60 or > 86_400)
        {
            throw new BrokerInvariantException("FreshnessWindowSeconds must be between 60 and 86400.");
        }

        return new RunSnapshot(
            request.RunId,
            request.WorkspaceId,
            request.DepartmentId,
            request.ScheduleId,
            BrokerRunState.WaitingForUser,
            ExecutionResidency.Workstation,
            request.ActorId,
            request.RequiredUserSid,
            NormalizeThumbprint(request.RequiredDeviceCertificateThumbprint),
            freshness,
            request.RequestedAt,
            request.RequestedAt.AddSeconds(freshness),
            workOrderId ?? Guid.NewGuid(),
            leaseId ?? Guid.NewGuid(),
            nonce ?? Base64Url.Encode(RandomNumberGenerator.GetBytes(32)),
            true,
            "Waiting for you to sign in.",
            false,
            null);
    }

    public static string NormalizeThumbprint(string thumbprint) =>
        thumbprint.Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
}
