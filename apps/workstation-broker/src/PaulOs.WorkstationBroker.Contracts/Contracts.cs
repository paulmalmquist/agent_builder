using System.Text.Json;
using System.Text.Json.Serialization;

namespace PaulOs.WorkstationBroker.Contracts;

[JsonConverter(typeof(JsonStringEnumConverter<ExecutionResidency>))]
public enum ExecutionResidency
{
    ControlPlane,
    Workstation,
}

[JsonConverter(typeof(JsonStringEnumConverter<BrokerRunState>))]
public enum BrokerRunState
{
    ControlPlaneReady,
    WaitingForUser,
    Leased,
    Executing,
    Completed,
    Failed,
    Cancelled,
    Expired,
}

public sealed record PluginRequirement(
    Guid PluginVersionId,
    string PluginDigest,
    Guid InstallationId,
    string Tool,
    ExecutionResidency Residency);

public sealed record PlacementRequest(
    Guid RunId,
    Guid WorkspaceId,
    Guid? DepartmentId,
    string ActorId,
    string RequiredUserSid,
    string RequiredDeviceCertificateThumbprint,
    Guid? ScheduleId,
    bool IsDailyBrief,
    int? FreshnessWindowSeconds,
    IReadOnlyList<PluginRequirement> Requirements,
    DateTimeOffset RequestedAt);

public sealed record RunSnapshot(
    Guid RunId,
    Guid WorkspaceId,
    Guid? DepartmentId,
    Guid? ScheduleId,
    BrokerRunState State,
    ExecutionResidency Placement,
    string RequiredActorId,
    string RequiredUserSid,
    string RequiredDeviceCertificateThumbprint,
    int? FreshnessWindowSeconds,
    DateTimeOffset? WaitingSince,
    DateTimeOffset? ExpiresAt,
    Guid? WorkOrderId,
    Guid? LeaseId,
    string? Nonce,
    bool AttentionRequired,
    string? AttentionReason,
    bool ExternalEffectsAllowed,
    string? DigestEventKey);

public sealed record WorkOrderPayload(
    string SchemaVersion,
    Guid WorkOrderId,
    Guid LeaseId,
    Guid RunId,
    Guid WorkspaceId,
    Guid? DepartmentId,
    Guid EntryResourceVersionId,
    string ReleaseDigest,
    Guid InstallationId,
    Guid PluginVersionId,
    string PluginDigest,
    string Tool,
    string RequiredActorId,
    string RequiredUserSid,
    string RequiredDeviceCertificateThumbprint,
    DateTimeOffset IssuedAt,
    DateTimeOffset NotBefore,
    DateTimeOffset ExpiresAt,
    DateTimeOffset LeaseExpiresAt,
    int FreshnessWindowSeconds,
    string Nonce,
    string InvocationKey,
    JsonElement Input);

public sealed record SignedWorkOrderEnvelope(
    string Algorithm,
    string KeyId,
    string PayloadBase64Url,
    string SignatureBase64Url);

public sealed record UserPresenceHandshake(
    Guid WorkOrderId,
    Guid LeaseId,
    string Nonce,
    string ActorId,
    string UserSid,
    string UserProofKind,
    string UserAccessToken);

public sealed record DualIdentityHandshake(
    Guid WorkOrderId,
    Guid LeaseId,
    string Nonce,
    string ActorId,
    string UserSid,
    string UserProofKind,
    string UserAccessToken,
    string DeviceCertificateThumbprint,
    string DeviceChallengeSignatureBase64Url);

public sealed record VerifiedDualIdentityBinding(
    Guid WorkOrderId,
    Guid LeaseId,
    string Nonce,
    string ActorId,
    string UserSid,
    string DeviceCertificateThumbprint,
    string UserTokenDigest,
    string DeviceProofDigest,
    DateTimeOffset VerifiedAt,
    string Verifier);

public sealed record ExpirationDigestItem(
    string IdempotencyKey,
    Guid RunId,
    DateTimeOffset OccurredAt,
    string Message,
    bool LateEffectsPerformed);

public sealed record ExpirationResult(RunSnapshot Snapshot, ExpirationDigestItem? DigestItem);

public sealed record FixtureDemoDescriptor(
    string SchemaVersion,
    string PipeName,
    Guid WorkOrderId,
    Guid LeaseId,
    string Nonce,
    string RequiredActorId,
    string RequiredUserSid,
    DateTimeOffset ExpiresAt);

public sealed record FixtureDemoResult(
    string SchemaVersion,
    Guid RunId,
    string Scenario,
    IReadOnlyList<string> States,
    bool UserProofVerified,
    bool DeviceProofVerified,
    bool ReplayRejected,
    bool ExternalEffectsPerformed,
    string? DigestEventKey,
    string Outcome);

public static class BrokerJson
{
    public static JsonSerializerOptions Strict { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = false,
    };
}
