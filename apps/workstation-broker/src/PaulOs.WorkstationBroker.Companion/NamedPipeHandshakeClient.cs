using System.IO.Pipes;
using System.Security.Principal;
using System.Text.Json;
using PaulOs.WorkstationBroker.Contracts;

namespace PaulOs.WorkstationBroker.Companion;

public static class NamedPipeHandshakeClient
{
    public static async ValueTask SendAsync(
        string pipeName,
        UserPresenceHandshake handshake,
        CancellationToken cancellationToken)
    {
        await using var pipe = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        await pipe.ConnectAsync(cancellationToken);
        await JsonSerializer.SerializeAsync(pipe, handshake, BrokerJson.Strict, cancellationToken);
        await pipe.FlushAsync(cancellationToken);
    }
}
