using System.IO.Pipes;
using System.Text.Json;
using Microsoft.Extensions.Options;
using PaulOs.WorkstationBroker.Contracts;
using PaulOs.WorkstationBroker.Core;

namespace PaulOs.WorkstationBroker.Service;

public sealed class BrokerSessionRunner(
    IWorkOrderTransport transport,
    IDeviceIdentityProvider deviceIdentity,
    WorkOrderCoordinator coordinator,
    ILocalPluginExecutor pluginExecutor,
    IOptions<BrokerOptions> options)
{
    private const int MaximumHandshakeBytes = 65_536;

    public async ValueTask ProcessAsync(
        WorkOrderDelivery delivery,
        CancellationToken cancellationToken)
    {
        var order = WorkOrderSignatures.VerifyAndRead(delivery.Envelope, delivery.SigningPublicKey);
        AssertExactDelivery(delivery.Order, order);
        var pipeName = $"{options.Value.PipePrefix}-{order.WorkOrderId:N}";
        var descriptor = new FixtureDemoDescriptor(
            "paul-os.fixture-descriptor/v1",
            pipeName,
            order.WorkOrderId,
            order.LeaseId,
            order.Nonce,
            order.RequiredActorId,
            order.RequiredUserSid,
            order.ExpiresAt);

        if (string.Equals(options.Value.FixtureScenario, "expiry", StringComparison.Ordinal))
        {
            await transport.ReportWaitingAsync(descriptor, cancellationToken);
            var expired = WaitingRunExpiry.Expire(delivery.WaitingState, order.ExpiresAt);
            await transport.ReportResultAsync(
                new FixtureDemoResult(
                    "paul-os.fixture-result/v1",
                    order.RunId,
                    "expiry",
                    ["waiting_for_user", "expired"],
                    false,
                    false,
                    false,
                    false,
                    expired.DigestItem?.IdempotencyKey,
                    "expired_without_late_work"),
                cancellationToken);
            return;
        }

        await using var pipe = SecureNamedPipeFactory.Create(pipeName, order.RequiredUserSid);
        await transport.ReportWaitingAsync(descriptor, cancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.FixtureHandshakeTimeoutSeconds));
        await pipe.WaitForConnectionAsync(timeout.Token);
        var user = await ReadHandshakeAsync(pipe, timeout.Token);
        var combined = await WorkOrderSession.BindCurrentDeviceAsync(
            order,
            user,
            deviceIdentity,
            DateTimeOffset.UtcNow,
            timeout.Token);
        var binding = await coordinator.VerifyDualIdentityAsync(
            order,
            combined,
            DateTimeOffset.UtcNow,
            timeout.Token);
        var leased = WorkOrderCoordinator.Resume(
            delivery.WaitingState,
            binding,
            DateTimeOffset.UtcNow);
        var receipt = await pluginExecutor.ExecuteAsync(order, timeout.Token);
        var replayRejected = false;
        if (string.Equals(options.Value.FixtureScenario, "replay", StringComparison.Ordinal))
        {
            try
            {
                await coordinator.VerifyDualIdentityAsync(
                    order,
                    combined,
                    DateTimeOffset.UtcNow,
                    timeout.Token);
            }
            catch (BrokerInvariantException exception)
                when (exception.Message.Contains("already been consumed", StringComparison.Ordinal))
            {
                replayRejected = true;
            }
            if (!replayRejected)
            {
                throw new BrokerInvariantException("Fixture replay was not rejected.");
            }
        }
        var completed = leased with
        {
            State = BrokerRunState.Completed,
            ExternalEffectsAllowed = false,
        };
        await transport.ReportResultAsync(
            new FixtureDemoResult(
                "paul-os.fixture-result/v1",
                order.RunId,
                options.Value.FixtureScenario,
                ["waiting_for_user", "leased", completed.State.ToString().ToLowerInvariant()],
                true,
                true,
                replayRejected,
                receipt.ExternalEffectsPerformed,
                null,
                "synthetic_fixture_completed"),
            cancellationToken);
    }

    private static async ValueTask<UserPresenceHandshake> ReadHandshakeAsync(
        NamedPipeServerStream pipe,
        CancellationToken cancellationToken)
    {
        await using var buffer = new MemoryStream();
        var chunk = new byte[4_096];
        while (true)
        {
            var read = await pipe.ReadAsync(chunk, cancellationToken);
            if (read == 0) break;
            if (buffer.Length + read > MaximumHandshakeBytes)
            {
                throw new BrokerInvariantException("The user-presence handshake exceeds its size limit.");
            }
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }
        if (buffer.Length == 0)
        {
            throw new BrokerInvariantException("The user-presence handshake is empty.");
        }
        buffer.Position = 0;
        return await JsonSerializer.DeserializeAsync<UserPresenceHandshake>(
                buffer,
                BrokerJson.Strict,
                cancellationToken)
            ?? throw new BrokerInvariantException("The user-presence handshake is invalid.");
    }

    private static void AssertExactDelivery(WorkOrderPayload expected, WorkOrderPayload actual)
    {
        if (expected.WorkOrderId != actual.WorkOrderId
            || expected.RunId != actual.RunId
            || !string.Equals(expected.ReleaseDigest, actual.ReleaseDigest, StringComparison.Ordinal)
            || expected.PluginVersionId != actual.PluginVersionId
            || !string.Equals(expected.PluginDigest, actual.PluginDigest, StringComparison.Ordinal)
            || !string.Equals(expected.Tool, actual.Tool, StringComparison.Ordinal))
        {
            throw new BrokerInvariantException("Signed work order does not match its transport delivery.");
        }
    }
}
