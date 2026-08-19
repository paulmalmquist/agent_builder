namespace PaulOs.WorkstationBroker.Core;

public sealed class BrokerInvariantException(string message) : InvalidOperationException(message);
