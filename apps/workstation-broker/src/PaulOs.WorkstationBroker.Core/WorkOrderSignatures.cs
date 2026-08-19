using System.Security.Cryptography;
using System.Text.Json;
using PaulOs.WorkstationBroker.Contracts;

namespace PaulOs.WorkstationBroker.Core;

public static class WorkOrderSignatures
{
    public static SignedWorkOrderEnvelope Sign(WorkOrderPayload payload, string keyId, RSA privateKey)
    {
        ValidatePayload(payload);
        ArgumentException.ThrowIfNullOrWhiteSpace(keyId);
        ArgumentNullException.ThrowIfNull(privateKey);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, BrokerJson.Strict);
        var signature = privateKey.SignData(bytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return new SignedWorkOrderEnvelope("RS256", keyId, Base64Url.Encode(bytes), Base64Url.Encode(signature));
    }

    public static WorkOrderPayload VerifyAndRead(SignedWorkOrderEnvelope envelope, RSA publicKey)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(publicKey);
        if (!string.Equals(envelope.Algorithm, "RS256", StringComparison.Ordinal))
        {
            throw new BrokerInvariantException("Only RS256 work-order signatures are accepted.");
        }
        var payloadBytes = Base64Url.Decode(envelope.PayloadBase64Url);
        var signature = Base64Url.Decode(envelope.SignatureBase64Url);
        if (!publicKey.VerifyData(payloadBytes, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
        {
            throw new BrokerInvariantException("The work-order signature is invalid.");
        }
        var payload = JsonSerializer.Deserialize<WorkOrderPayload>(payloadBytes, BrokerJson.Strict)
            ?? throw new BrokerInvariantException("The work-order payload is empty.");
        ValidatePayload(payload);
        return payload;
    }

    public static void ValidatePayload(WorkOrderPayload payload)
    {
        ArgumentNullException.ThrowIfNull(payload);
        if (!string.Equals(payload.SchemaVersion, "paul-os.workstation-work-order/v1", StringComparison.Ordinal))
        {
            throw new BrokerInvariantException("Unsupported workstation work-order schema version.");
        }
        if (payload.NotBefore < payload.IssuedAt || payload.ExpiresAt <= payload.NotBefore)
        {
            throw new BrokerInvariantException("Work-order validity timestamps are invalid.");
        }
        if (payload.LeaseExpiresAt <= payload.NotBefore || payload.LeaseExpiresAt > payload.ExpiresAt)
        {
            throw new BrokerInvariantException("Work-order lease timestamps are invalid.");
        }
        if (payload.ExpiresAt - payload.IssuedAt > TimeSpan.FromSeconds(payload.FreshnessWindowSeconds))
        {
            throw new BrokerInvariantException("A work order cannot outlive its freshness window.");
        }
        if (string.IsNullOrWhiteSpace(payload.RequiredActorId)
            || string.IsNullOrWhiteSpace(payload.RequiredUserSid)
            || string.IsNullOrWhiteSpace(payload.RequiredDeviceCertificateThumbprint)
            || string.IsNullOrWhiteSpace(payload.Nonce))
        {
            throw new BrokerInvariantException("Work orders require exact actor and device bindings.");
        }
    }
}
