using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;

namespace PaulOs.WorkstationBroker.Service;

public static class SecureNamedPipeFactory
{
    public static NamedPipeServerStream Create(string pipeName, string requiredUserSid)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Workstation named pipes require Windows.");
        }
        if (string.IsNullOrWhiteSpace(pipeName) || pipeName.Any(character => character is '\\' or '/'))
        {
            throw new ArgumentException("Pipe names must be a single bounded local identifier.", nameof(pipeName));
        }
        var user = new SecurityIdentifier(requiredUserSid);
        var localSystem = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
        var security = new PipeSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(
            new PipeAccessRule(user, PipeAccessRights.ReadWrite, AccessControlType.Allow));
        security.AddAccessRule(
            new PipeAccessRule(localSystem, PipeAccessRights.FullControl, AccessControlType.Allow));
        return NamedPipeServerStreamAcl.Create(
            pipeName,
            PipeDirection.InOut,
            maxNumberOfServerInstances: 1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.WriteThrough,
            inBufferSize: 16_384,
            outBufferSize: 16_384,
            security);
    }
}
