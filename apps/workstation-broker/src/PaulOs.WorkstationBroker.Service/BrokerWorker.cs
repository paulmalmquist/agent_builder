using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using PaulOs.WorkstationBroker.Contracts;

namespace PaulOs.WorkstationBroker.Service;

public sealed record WorkOrderDelivery(
    SignedWorkOrderEnvelope Envelope,
    WorkOrderPayload Order,
    RunSnapshot WaitingState,
    RSA SigningPublicKey) : IDisposable
{
    public void Dispose() => SigningPublicKey.Dispose();
}

public interface IWorkOrderTransport
{
    ValueTask<WorkOrderDelivery?> ReceiveAsync(CancellationToken cancellationToken);
    ValueTask ReportWaitingAsync(
        FixtureDemoDescriptor descriptor,
        CancellationToken cancellationToken);
    ValueTask ReportResultAsync(FixtureDemoResult result, CancellationToken cancellationToken);
}

public sealed record LocalPluginExecutionReceipt(
    string OutcomeDigest,
    bool ExternalEffectsPerformed);

public interface ILocalPluginExecutor
{
    ValueTask<LocalPluginExecutionReceipt> ExecuteAsync(
        WorkOrderPayload order,
        CancellationToken cancellationToken);
}

public sealed class FailClosedWorkOrderTransport(IOptions<BrokerOptions> options) : IWorkOrderTransport
{
    public ValueTask<WorkOrderDelivery?> ReceiveAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!string.Equals(options.Value.Mode, "production", StringComparison.OrdinalIgnoreCase))
        {
            return ValueTask.FromResult<WorkOrderDelivery?>(null);
        }
        throw new InvalidOperationException(
            "Production work-order transport is a proposal seam and is not configured. No work was accepted.");
    }

    public ValueTask ReportWaitingAsync(
        FixtureDemoDescriptor descriptor,
        CancellationToken cancellationToken) =>
        throw new InvalidOperationException(
            "The production control-plane transport is not configured; waiting state was not acknowledged.");

    public ValueTask ReportResultAsync(
        FixtureDemoResult result,
        CancellationToken cancellationToken) =>
        throw new InvalidOperationException(
            "The production control-plane transport is not configured; no result was reported.");
}

public sealed class UnconfiguredLocalPluginExecutor : ILocalPluginExecutor
{
    public ValueTask<LocalPluginExecutionReceipt> ExecuteAsync(
        WorkOrderPayload order,
        CancellationToken cancellationToken) =>
        throw new InvalidOperationException(
            "No local Plugin executor is installed. The broker never executes arbitrary commands by default.");
}

public sealed class BrokerWorker(
    IWorkOrderTransport transport,
    BrokerSessionRunner sessionRunner,
    IOptions<BrokerOptions> options,
    IHostApplicationLifetime applicationLifetime,
    ILogger<BrokerWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "Workstation broker started in {Mode} mode.",
            options.Value.FixtureMode ? "local fixture" : "fail-closed transport");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var delivery = await transport.ReceiveAsync(stoppingToken);
                if (delivery is not null)
                {
                    using (delivery)
                    {
                        await sessionRunner.ProcessAsync(delivery, stoppingToken);
                    }
                    if (options.Value.FixtureMode)
                    {
                        applicationLifetime.StopApplication();
                        return;
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Broker session failed closed; no unverified local work continued.");
                if (options.Value.FixtureMode)
                {
                    Environment.ExitCode = 3;
                    applicationLifetime.StopApplication();
                    return;
                }
            }
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
