# Owns one managed component process tree and records enough identity information
# for the watchdog and stop script to distinguish it from unrelated processes.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('porta', 'tunnel')]
    [string] $Component,

    [Parameter(Mandatory = $true)]
    [string] $InstanceId,

    [Parameter(Mandatory = $true)]
    [string] $StateDirectory,

    [Parameter(Mandatory = $true)]
    [string] $CommandScript,

    [string] $PortaRuntimeConfigHash = '',
    [string] $CloudflaredConfig = '',
    [string] $CloudflaredConfigHash = '',
    [int] $TunnelMetricsPort = 20241
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
. (Join-Path $ScriptDir 'watchdog-common.ps1')

if (-not ('Porta.ManagedJob.NativeMethods' -as [type])) {
    $jobInteropSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Porta.ManagedJob
{
    public static class NativeMethods
    {
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_NO_WINDOW = 0x08000000;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint INFINITE = 0xFFFFFFFF;
        private const uint WAIT_FAILED = 0xFFFFFFFF;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public uint dwProcessId;
            public uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(
            IntPtr lpJobAttributes,
            string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob,
            int JobObjectInformationClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInformation,
            uint cbJobObjectInformationLength);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(
            IntPtr hJob,
            IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(
            IntPtr hHandle,
            uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(
            IntPtr hProcess,
            out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(
            IntPtr hProcess,
            uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        private static Win32Exception LastWin32Exception(string operation)
        {
            return new Win32Exception(
                Marshal.GetLastWin32Error(),
                operation + " failed");
        }

        public static IntPtr CreateKillOnCloseJob()
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                throw LastWin32Exception("CreateJobObject");
            }

            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            uint size = (uint)Marshal.SizeOf(
                typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                ref limits,
                size))
            {
                int error = Marshal.GetLastWin32Error();
                CloseHandle(job);
                throw new Win32Exception(
                    error,
                    "SetInformationJobObject failed");
            }

            return job;
        }

        public static PROCESS_INFORMATION CreateSuspendedProcess(
            string applicationName,
            string commandLine,
            string currentDirectory)
        {
            STARTUPINFO startupInfo = new STARTUPINFO();
            startupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFO));

            PROCESS_INFORMATION processInformation;
            if (!CreateProcess(
                applicationName,
                new StringBuilder(commandLine),
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_SUSPENDED | CREATE_NO_WINDOW,
                IntPtr.Zero,
                currentDirectory,
                ref startupInfo,
                out processInformation))
            {
                throw LastWin32Exception("CreateProcess");
            }

            return processInformation;
        }

        public static void AssignToJob(
            IntPtr job,
            IntPtr process)
        {
            if (!AssignProcessToJobObject(job, process))
            {
                throw LastWin32Exception("AssignProcessToJobObject");
            }
        }

        public static void ResumeProcessThread(IntPtr thread)
        {
            if (ResumeThread(thread) == uint.MaxValue)
            {
                throw LastWin32Exception("ResumeThread");
            }
        }

        public static int WaitForProcessExit(IntPtr process)
        {
            if (WaitForSingleObject(process, INFINITE) == WAIT_FAILED)
            {
                throw LastWin32Exception("WaitForSingleObject");
            }

            uint exitCode;
            if (!GetExitCodeProcess(process, out exitCode))
            {
                throw LastWin32Exception("GetExitCodeProcess");
            }

            return unchecked((int)exitCode);
        }

        public static void TerminateProcessBestEffort(
            IntPtr process,
            uint exitCode)
        {
            if (process != IntPtr.Zero)
            {
                TerminateProcess(process, exitCode);
            }
        }

        public static void CloseHandleBestEffort(IntPtr handle)
        {
            if (handle != IntPtr.Zero && handle != new IntPtr(-1))
            {
                CloseHandle(handle);
            }
        }
    }
}
'@

    Add-Type -TypeDefinition $jobInteropSource -Language CSharp
}

if (-not (Test-Path -LiteralPath $CommandScript -PathType Leaf)) {
    throw "Managed command script does not exist: $CommandScript"
}

if ($Component -eq 'porta') {
    if ($PortaRuntimeConfigHash -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'Expected pinned Porta environment SHA256 is missing or malformed.'
    }

    $actualRuntimeConfigHash = Get-PortaPinnedEnvironmentHash `
        -RequireAuth ([string] $env:PORTA_REQUIRE_AUTH) `
        -AccessToken ([string] $env:PORTA_ACCESS_TOKEN) `
        -HostName ([string] $env:PORTA_HOST) `
        -ProxyPort ([string] $env:PORTA_PORT) `
        -WebPort ([string] $env:PORTA_WEB_PORT) `
        -AllowedHosts ([string] $env:PORTA_ALLOWED_HOSTS) `
        -CorsOrigins ([string] $env:PORTA_CORS_ORIGINS)
    if (-not [string]::Equals(
        $PortaRuntimeConfigHash,
        $actualRuntimeConfigHash,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw 'Pinned Porta environment changed before the managed app could start.'
    }
}

if ($Component -eq 'tunnel') {
    if (-not (Test-Path -LiteralPath $CloudflaredConfig -PathType Leaf)) {
        throw "Cloudflared config does not exist: $CloudflaredConfig"
    }
    if ($CloudflaredConfigHash -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'Expected Cloudflared config SHA256 is missing or malformed.'
    }

    $actualConfigHash = (Get-FileHash -LiteralPath $CloudflaredConfig -Algorithm SHA256).Hash
    if (-not [string]::Equals(
        $CloudflaredConfigHash,
        $actualConfigHash,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw 'Cloudflared config changed before the managed tunnel could start.'
    }

    $env:CLOUDFLARED_CONFIG = $CloudflaredConfig
    $env:PORTA_TUNNEL_METRICS_PORT = [string] $TunnelMetricsPort
    $env:PORTA_WATCHDOG_STATE_DIR = $StateDirectory
}

$state = [pscustomobject] @{
    component     = $Component
    instanceId    = $InstanceId
    runnerPid     = $PID
    startedAtUtc  = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('O')
    runnerScript  = [System.IO.Path]::GetFullPath($PSCommandPath)
    commandScript = [System.IO.Path]::GetFullPath($CommandScript)
    portaRuntimeConfigHash = $PortaRuntimeConfigHash
    cloudflaredConfig = $CloudflaredConfig
    cloudflaredConfigHash = $CloudflaredConfigHash
    tunnelMetricsPort = $TunnelMetricsPort
}
Write-PortaComponentState -StateDirectory $StateDirectory -Component $Component -State $state

$exitCode = 1
$jobHandle = [IntPtr]::Zero
$processHandle = [IntPtr]::Zero
$threadHandle = [IntPtr]::Zero
$assignedToJob = $false
try {
    $command = 'call "' + $CommandScript.Replace('"', '""') + '"'
    $commandLine = '"' + $env:ComSpec + '" /d /s /c ' + $command

    # Create cmd.exe suspended so it cannot start descendants before becoming a
    # member of the kill-on-close job. If this runner exits unexpectedly, Windows
    # closes its last job handle and terminates the complete managed process tree.
    $jobHandle = [Porta.ManagedJob.NativeMethods]::CreateKillOnCloseJob()
    $processInfo = [Porta.ManagedJob.NativeMethods]::CreateSuspendedProcess(
        $env:ComSpec,
        $commandLine,
        [Environment]::CurrentDirectory
    )
    $processHandle = $processInfo.hProcess
    $threadHandle = $processInfo.hThread

    [Porta.ManagedJob.NativeMethods]::AssignToJob($jobHandle, $processHandle)
    $assignedToJob = $true
    [Porta.ManagedJob.NativeMethods]::ResumeProcessThread($threadHandle)
    [Porta.ManagedJob.NativeMethods]::CloseHandleBestEffort($threadHandle)
    $threadHandle = [IntPtr]::Zero

    $exitCode = [Porta.ManagedJob.NativeMethods]::WaitForProcessExit(
        $processHandle
    )
}
finally {
    if (-not $assignedToJob) {
        [Porta.ManagedJob.NativeMethods]::TerminateProcessBestEffort(
            $processHandle,
            1
        )
    }
    [Porta.ManagedJob.NativeMethods]::CloseHandleBestEffort($threadHandle)
    [Porta.ManagedJob.NativeMethods]::CloseHandleBestEffort($processHandle)
    # Close the job last. JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE then cleans up any
    # descendants still alive after cmd.exe exits, as well as on error paths.
    [Porta.ManagedJob.NativeMethods]::CloseHandleBestEffort($jobHandle)

    $current = Read-PortaComponentState -StateDirectory $StateDirectory -Component $Component
    if ($null -ne $current -and [int] $current.runnerPid -eq $PID) {
        $statePath = Get-PortaComponentStatePath -StateDirectory $StateDirectory -Component $Component
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
