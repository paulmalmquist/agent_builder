using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PaulOs.WorkstationBroker.Core;

public static class FixtureOidcToken
{
    // Public fixture material, deliberately not a credential. Production code never accepts it.
    private static readonly byte[] FixtureKey =
        Encoding.UTF8.GetBytes("paul-os-public-fixture-oidc-integrity-key-v1-not-a-secret");

    public static string Issue(
        string actorId,
        string userSid,
        DateTimeOffset expiresAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actorId);
        ArgumentException.ThrowIfNullOrWhiteSpace(userSid);
        var payload = JsonSerializer.SerializeToUtf8Bytes(
            new FixtureClaims("paul-os-local-fixture", actorId, userSid, expiresAt.ToUnixTimeSeconds()),
            BrokerJsonOptions.Canonical);
        var signature = HMACSHA256.HashData(FixtureKey, payload);
        return $"fixture_oidc.{Base64Url.Encode(payload)}.{Base64Url.Encode(signature)}";
    }

    public static bool Verify(
        string token,
        string expectedActorId,
        string expectedUserSid,
        DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        var parts = token.Split('.', StringSplitOptions.None);
        if (parts is not ["fixture_oidc", _, _]) return false;
        try
        {
            var payload = Base64Url.Decode(parts[1]);
            var actualSignature = Base64Url.Decode(parts[2]);
            var expectedSignature = HMACSHA256.HashData(FixtureKey, payload);
            if (!CryptographicOperations.FixedTimeEquals(actualSignature, expectedSignature)) return false;
            var claims = JsonSerializer.Deserialize<FixtureClaims>(payload, BrokerJsonOptions.Canonical);
            return claims is not null
                && string.Equals(claims.Issuer, "paul-os-local-fixture", StringComparison.Ordinal)
                && string.Equals(claims.Subject, expectedActorId, StringComparison.Ordinal)
                && string.Equals(claims.UserSid, expectedUserSid, StringComparison.Ordinal)
                && now.ToUnixTimeSeconds() < claims.ExpiresAt;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or CryptographicException)
        {
            return false;
        }
    }

    private sealed record FixtureClaims(
        string Issuer,
        string Subject,
        string UserSid,
        long ExpiresAt);
}

internal static class BrokerJsonOptions
{
    public static JsonSerializerOptions Canonical { get; } = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = false,
    };
}
