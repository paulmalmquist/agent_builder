using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

namespace PaulOs.WorkstationBroker.Companion;

public interface IUserTokenProvider
{
    ValueTask<string> AcquireAsync(CancellationToken cancellationToken);
}

public sealed class WamUserTokenProvider(
    string clientId,
    string authority,
    IReadOnlyList<string> scopes) : IUserTokenProvider
{
    public async ValueTask<string> AcquireAsync(CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10))
        {
            throw new PlatformNotSupportedException("WAM requires a supported Windows workstation.");
        }
        if (string.IsNullOrWhiteSpace(clientId)
            || !Uri.TryCreate(authority, UriKind.Absolute, out var authorityUri)
            || !string.Equals(authorityUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || scopes.Count == 0)
        {
            throw new InvalidOperationException("WAM identity configuration is incomplete.");
        }
        var application = PublicClientApplicationBuilder
            .Create(clientId)
            .WithAuthority(authority)
            .WithDefaultRedirectUri()
            .WithBroker(new BrokerOptions(BrokerOptions.OperatingSystems.Windows))
            .Build();
        var result = await application
            .AcquireTokenInteractive(scopes)
            .ExecuteAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(result.AccessToken))
        {
            throw new InvalidOperationException("WAM returned no current-user access token.");
        }
        return result.AccessToken;
    }
}

public sealed class FixtureOidcUserTokenProvider(string token) : IUserTokenProvider
{
    public ValueTask<string> AcquireAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!token.StartsWith("fixture_oidc.", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Fixture token is invalid.");
        }
        return ValueTask.FromResult(token);
    }
}
