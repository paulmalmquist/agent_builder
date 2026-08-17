using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Options;
using PaulOs.WorkstationBroker.Core;

namespace PaulOs.WorkstationBroker.Service;

public sealed record DeviceProof(string CertificateThumbprint, string SignatureBase64Url);

public interface IDeviceIdentityProvider
{
    ValueTask<DeviceProof> SignChallengeAsync(string nonce, CancellationToken cancellationToken);
}

public sealed class WindowsCertificateStoreDeviceIdentityProvider(IOptions<BrokerOptions> options)
    : IDeviceIdentityProvider
{
    public ValueTask<DeviceProof> SignChallengeAsync(
        string nonce,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (options.Value.FixtureMode)
        {
            throw new InvalidOperationException(
                "The production certificate provider cannot run while fixture mode is enabled.");
        }
        var expected = options.Value.DeviceCertificateThumbprint?.Replace(" ", string.Empty, StringComparison.Ordinal)
            ?? throw new InvalidOperationException("A device certificate thumbprint is required.");
        using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
        store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
        var certificate = store.Certificates
            .Find(X509FindType.FindByThumbprint, expected, validOnly: true)
            .OfType<X509Certificate2>()
            .SingleOrDefault()
            ?? throw new InvalidOperationException(
                "The configured valid, non-exported machine certificate was not found.");
        using var key = certificate.GetRSAPrivateKey()
            ?? throw new InvalidOperationException("The machine certificate has no RSA private key.");
        var signature = key.SignData(
            Base64Url.Decode(nonce),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        return ValueTask.FromResult(
            new DeviceProof(
                certificate.Thumbprint.ToUpperInvariant(),
                Base64Url.Encode(signature)));
    }
}

public sealed class EphemeralDevelopmentDeviceIdentityProvider : IDeviceIdentityProvider, IDisposable
{
    private readonly RSA key = RSA.Create(2048);
    private readonly X509Certificate2 certificate;

    public EphemeralDevelopmentDeviceIdentityProvider()
    {
        var request = new CertificateRequest(
            "CN=Paul OS Local Fixture Device",
            key,
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        certificate = request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-1),
            DateTimeOffset.UtcNow.AddDays(1));
    }

    public string Thumbprint => certificate.Thumbprint.ToUpperInvariant();
    public RSA PublicKey => certificate.GetRSAPublicKey()
        ?? throw new InvalidOperationException("The fixture certificate has no RSA public key.");

    public ValueTask<DeviceProof> SignChallengeAsync(
        string nonce,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var signature = key.SignData(
            Base64Url.Decode(nonce),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        return ValueTask.FromResult(new DeviceProof(Thumbprint, Base64Url.Encode(signature)));
    }

    public void Dispose()
    {
        certificate.Dispose();
        key.Dispose();
    }
}
