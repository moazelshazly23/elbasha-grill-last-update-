param(
    [Parameter(Mandatory=$true)]
    [string]$PrinterName,

    [Parameter(Mandatory=$false)]
    [string]$FilePath = "",

    [switch]$DiagnoseOnly
)

$ErrorActionPreference = "Stop"

function Write-ResultAndExit {
    param(
        [bool]$Ok,
        [string]$ErrorCode = "",
        [string]$ErrorMessage = "",
        [string]$Stage = "",
        [int]$Win32Error = 0,
        [string]$ResolvedPrinter = "",
        [string]$DriverName = "",
        [string]$PortName = "",
        [string]$PrinterStatus = "",
        [bool]$WorkOffline = $false,
        [string]$SpoolerStatus = "Unknown",
        [int]$BytesSent = 0,
        [string[]]$InstalledPrinters = @(),
        [int]$ExitCode = 0
    )

    $payload = @{
        ok = $Ok
        errorCode = $ErrorCode
        error = $ErrorMessage
        stage = $Stage
        win32Error = $Win32Error
        resolvedPrinter = $ResolvedPrinter
        driverName = $DriverName
        portName = $PortName
        printerStatus = $PrinterStatus
        workOffline = $WorkOffline
        spoolerStatus = $SpoolerStatus
        bytesSent = $BytesSent
        installedPrinters = $InstalledPrinters
    } | ConvertTo-Json -Compress -Depth 4

    Write-Output "WIN32_RESULT_JSON:$payload"
    if ($Ok -and -not $DiagnoseOnly) {
        Write-Output "RAW_PRINT_OK:${ResolvedPrinter}:${BytesSent}"
    } elseif (-not $Ok) {
        [Console]::Error.WriteLine($ErrorMessage)
    }
    exit $ExitCode
}

# 1. Verify Windows Print Spooler Service
$spoolerStatus = "Unknown"
try {
    $svc = Get-Service -Name "Spooler" -ErrorAction Stop
    $spoolerStatus = [string]$svc.Status
    if ($svc.Status -ne "Running") {
        Write-ResultAndExit -Ok $false -ErrorCode "USB_SPOOLER_UNAVAILABLE" `
            -ErrorMessage "خدمة Windows Print Spooler متوقفة حالياً ($spoolerStatus). يرجى تشغيل خدمة Spooler من services.msc." `
            -Stage "SpoolerServiceCheck" -SpoolerStatus $spoolerStatus -ExitCode 5
    }
} catch {
    $spoolerStatus = "Unavailable"
}

$labelPrinterPattern = "(?i)(TSPL|TSC|ZEBRA|ZD220|ZD230|XP-365|XP-420|XP-370|BARCODE|LABEL|STICKER|GODEX|ARGOX)"
$virtualPrinterPattern = "(?i)(Microsoft Print to PDF|Microsoft XPS|OneNote|Fax|Send To OneNote|Adobe PDF)"

# 2. Enumerate & Validate Windows Printers
$installedList = @()
$matchedPrinterObj = $null
$installedNames = @()

try {
    $rawPrinters = @(Get-Printer | Select-Object -Property Name, Default, DriverName, PortName, PrinterStatus, WorkOffline, Shared)
    $installedList = $rawPrinters
    $installedNames = @($rawPrinters | ForEach-Object { [string]$_.Name })
} catch {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_SPOOLER_UNAVAILABLE" `
        -ErrorMessage "تعذر قراءة الطابعات المثبتة من Windows Spooler: $($_.Exception.Message)" `
        -Stage "EnumeratePrinters" -SpoolerStatus $spoolerStatus -ExitCode 5
}

$cleanReq = ($PrinterName -replace '\s*\[.*?\]\s*$', '').Trim()
if ($cleanReq -match $labelPrinterPattern) {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_LABEL_PRINTER_BLOCKED" `
        -ErrorMessage "تم رفض الطابعة '$cleanReq' لأنها مصنفة كطابعة باركود/ملصقات TSPL وليست طابعة فواتير Rongta RP350." `
        -Stage "PrinterValidation" -SpoolerStatus $spoolerStatus -InstalledPrinters $installedNames -ExitCode 3
}

# Match Priority 1: Exact name match
$exactMatch = $installedList | Where-Object {
    ([string]$_.Name -ieq $PrinterName -or [string]$_.Name -ieq $cleanReq) -and ([string]$_.Name -notmatch $labelPrinterPattern)
} | Select-Object -First 1

if ($exactMatch) {
    $matchedPrinterObj = $exactMatch
} else {
    # Match Priority 2: Normalized substring or Rongta RP350 / POS-80 / USB thermal aliases
    $reqNormalized = ($cleanReq -replace '[\s\-_()]', '').ToLowerInvariant()
    $wantsCashierThermal = ($cleanReq -match "(?i)(RP350|Rongta|Cashier|USB|كاشير|80mm|POS)")

    $partialMatch = $installedList | Where-Object {
        $n = [string]$_.Name
        $d = [string]$_.DriverName
        $p = [string]$_.PortName
        if ($n -match $labelPrinterPattern -or $d -match $labelPrinterPattern) { return $false }
        if ($n -match $virtualPrinterPattern) { return $false }
        $nNorm = ($n -replace '[\s\-_()]', '').ToLowerInvariant()
        if ($reqNormalized -and $nNorm.Contains($reqNormalized)) { return $true }
        if ($wantsCashierThermal -and ($n -match "(?i)RP-?350|RONGTA|POS-?80|80mm|Thermal" -or $d -match "(?i)RP-?350|RONGTA|POS-?80") -and ($p -match "(?i)USB|DOT|TMUSB|PRN" -or -not ($n -match "(?i)Kitchen|مطبخ"))) {
            return $true
        }
        return $false
    } | Select-Object -First 1

    if ($partialMatch) {
        $matchedPrinterObj = $partialMatch
    } else {
        # Match Priority 3: Windows Default Printer ONLY if genuinely a thermal receipt printer
        $defaultThermal = $installedList | Where-Object {
            $_.Default -eq $true -and
            ([string]$_.Name -notmatch $labelPrinterPattern) -and
            ([string]$_.Name -notmatch $virtualPrinterPattern) -and
            ([string]$_.Name -match "(?i)RP-?350|RONGTA|80mm|POS-?80|Thermal|Receipt" -or [string]$_.DriverName -match "(?i)RP-?350|RONGTA|POS-?80|80mm")
        } | Select-Object -First 1
        if ($defaultThermal) {
            $matchedPrinterObj = $defaultThermal
        }
    }
}

if (-not $matchedPrinterObj) {
    $errCode = if ($installedNames.Count -eq 0) { "USB_PRINTER_NOT_FOUND" } else { "USB_INCORRECT_NAME" }
    Write-ResultAndExit -Ok $false -ErrorCode $errCode `
        -ErrorMessage "لم يتم العثور على طابعة حرارية مطابقة لـ '$cleanReq' في Windows Spooler. الطابعات المتاحة: [$($installedNames -join ', ')]" `
        -Stage "PrinterLookup" -SpoolerStatus $spoolerStatus -InstalledPrinters $installedNames -ExitCode 4
}

$resolvedName = [string]$matchedPrinterObj.Name
$driverName = [string]$matchedPrinterObj.DriverName
$portName = [string]$matchedPrinterObj.PortName
$printerStatusStr = [string]$matchedPrinterObj.PrinterStatus
$workOffline = [bool]$matchedPrinterObj.WorkOffline

if ($workOffline -or $printerStatusStr -match "(?i)Offline") {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_PRINTER_OFFLINE" `
        -ErrorMessage "الطابعة '$resolvedName' في وضع غير متصل (Offline) على المنفذ '$portName'. تأكد من توصيل كابل USB وتشغيل الطابعة بالكهرباء." `
        -Stage "PrinterStatusCheck" -ResolvedPrinter $resolvedName -DriverName $driverName -PortName $portName `
        -PrinterStatus $printerStatusStr -WorkOffline $workOffline -SpoolerStatus $spoolerStatus `
        -InstalledPrinters $installedNames -ExitCode 6
}

if ($printerStatusStr -match "(?i)Paused") {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_PRINTER_PAUSED" `
        -ErrorMessage "الطابعة '$resolvedName' متوقفة مؤقتاً (Paused) في قائمة الانتظار بـ Windows." `
        -Stage "PrinterStatusCheck" -ResolvedPrinter $resolvedName -DriverName $driverName -PortName $portName `
        -PrinterStatus $printerStatusStr -WorkOffline $workOffline -SpoolerStatus $spoolerStatus `
        -InstalledPrinters $installedNames -ExitCode 7
}

if ($printerStatusStr -match "(?i)Error|PaperOut|PaperJam|DoorOpen|NoToner|UserIntervention") {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_PRINTER_ERROR" `
        -ErrorMessage "الطابعة '$resolvedName' تسجل حالة خطأ ($printerStatusStr) — افحص وجود ورق 80mm وإغلاق الغطاء." `
        -Stage "PrinterStatusCheck" -ResolvedPrinter $resolvedName -DriverName $driverName -PortName $portName `
        -PrinterStatus $printerStatusStr -WorkOffline $workOffline -SpoolerStatus $spoolerStatus `
        -InstalledPrinters $installedNames -ExitCode 8
}

if ($DiagnoseOnly) {
    Write-ResultAndExit -Ok $true -Stage "DiagnoseComplete" `
        -ResolvedPrinter $resolvedName -DriverName $driverName -PortName $portName `
        -PrinterStatus $printerStatusStr -WorkOffline $workOffline -SpoolerStatus $spoolerStatus `
        -InstalledPrinters $installedNames -ExitCode 0
}

# 3. Validate Payload File & Reject Any Leaked TSPL Commands
if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath)) {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_WRITE_FAILED" `
        -ErrorMessage "ملف بايتات الطباعة المؤقت غير موجود: $FilePath" `
        -Stage "PayloadRead" -ResolvedPrinter $resolvedName -DriverName $driverName -PortName $portName `
        -PrinterStatus $printerStatusStr -SpoolerStatus $spoolerStatus -InstalledPrinters $installedNames -ExitCode 1
}

[byte[]]$rawBytes = [System.IO.File]::ReadAllBytes($FilePath)
if ($rawBytes.Length -eq 0) {
    Write-ResultAndExit -Ok $false -ErrorCode "USB_WRITE_FAILED" `
        -ErrorMessage "بيانات الطباعة فارغة (0 bytes)." `
        -Stage "PayloadValidation" -ResolvedPrinter $resolvedName -SpoolerStatus $spoolerStatus -ExitCode 1
}

$scanLimit = [Math]::Min($rawBytes.Length, 1024)
$asciiPreview = ""
for ($i = 0; $i -lt $scanLimit; $i++) {
    $b = $rawBytes[$i]
    if ($b -eq 10 -or $b -eq 13 -or ($b -ge 32 -and $b -le 126)) {
        $asciiPreview += [char]$b
    } else {
        $asciiPreview += " "
    }
}
if ($asciiPreview -match "(?im)(?:^|[\r\n])\s*(SIZE\s+\d+|DIRECTION\s+\d+|REFERENCE\s+\d+|SET\s+(?:PEEL|CUTTER|TEAR)|CLS\s*$|PRINT\s+\d+,\d+)") {
    Write-ResultAndExit -Ok $false -ErrorCode "TSPL_COMMAND_BLOCKED" `
        -ErrorMessage "تم حظر إرسال أوامر TSPL الخاصة بملصقات الباركود إلى طابعة الفواتير Rongta RP350." `
        -Stage "TsplGuard" -ResolvedPrinter $resolvedName -SpoolerStatus $spoolerStatus -ExitCode 3
}

# 4. Dispatch Raw ESC/POS Bytes via Win32 winspool.drv with Step-by-Step Error Tracking
$csharpSource = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterResult
{
    public bool Success;
    public string Stage;
    public int Win32Error;
    public int BytesWritten;
    public string Message;
}

public class RawPrinterHelperV2
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static RawPrinterResult SendBytesToPrinter(string szPrinterName, byte[] data)
    {
        var res = new RawPrinterResult();
        res.Success = false;
        res.Stage = "Init";
        res.Win32Error = 0;
        res.BytesWritten = 0;
        res.Message = "";

        IntPtr hPrinter = IntPtr.Zero;
        bool docStarted = false;
        bool pageStarted = false;

        try
        {
            if (!OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero)
            {
                res.Stage = "OpenPrinter";
                res.Win32Error = Marshal.GetLastWin32Error();
                res.Message = "OpenPrinter failed";
                return res;
            }

            var di = new DOCINFOW();
            di.pDocName = "El Basha POS Thermal Receipt (RAW ESC/POS)";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di))
            {
                res.Stage = "StartDocPrinter";
                res.Win32Error = Marshal.GetLastWin32Error();
                res.Message = "StartDocPrinter failed";
                return res;
            }
            docStarted = true;

            if (!StartPagePrinter(hPrinter))
            {
                res.Stage = "StartPagePrinter";
                res.Win32Error = Marshal.GetLastWin32Error();
                res.Message = "StartPagePrinter failed";
                return res;
            }
            pageStarted = true;

            IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(data.Length);
            try
            {
                Marshal.Copy(data, 0, pUnmanagedBytes, data.Length);
                int dwWritten = 0;
                bool wrote = WritePrinter(hPrinter, pUnmanagedBytes, data.Length, out dwWritten);
                res.BytesWritten = dwWritten;
                if (!wrote || dwWritten != data.Length)
                {
                    res.Stage = "WritePrinter";
                    res.Win32Error = Marshal.GetLastWin32Error();
                    res.Message = wrote ? "Incomplete WritePrinter byte count" : "WritePrinter returned false";
                    return res;
                }
            }
            finally
            {
                Marshal.FreeCoTaskMem(pUnmanagedBytes);
            }

            res.Success = true;
            res.Stage = "Completed";
            res.Message = "OK";
            return res;
        }
        finally
        {
            if (pageStarted && hPrinter != IntPtr.Zero) { try { EndPagePrinter(hPrinter); } catch {} }
            if (docStarted && hPrinter != IntPtr.Zero) { try { EndDocPrinter(hPrinter); } catch {} }
            if (hPrinter != IntPtr.Zero) { try { ClosePrinter(hPrinter); } catch {} }
        }
    }
}
"@

Add-Type -TypeDefinition $csharpSource -Language CSharp

$printOutcome = [RawPrinterHelperV2]::SendBytesToPrinter($resolvedName, $rawBytes)

if (-not $printOutcome.Success) {
    $winErr = [int]$printOutcome.Win32Error
    $stage = [string]$printOutcome.Stage
    $errCode = "USB_WRITE_FAILED"
    if ($winErr -eq 5) { $errCode = "USB_ACCESS_DENIED" }
    elseif ($winErr -eq 1801) { $errCode = "USB_PRINTER_NOT_FOUND" }
    elseif ($winErr -eq 1722) { $errCode = "USB_SPOOLER_UNAVAILABLE" }
    elseif ($stage -eq "OpenPrinter") { $errCode = "USB_OPEN_PRINTER_FAILED" }
    elseif ($stage -eq "StartDocPrinter") { $errCode = "USB_START_DOC_FAILED" }

    Write-ResultAndExit -Ok $false -ErrorCode $errCode `
        -ErrorMessage "فشل إرسال البيانات إلى الطابعة '$resolvedName' في مرحلة $stage (Win32=$winErr, المكتوب=$($printOutcome.BytesWritten)/$($rawBytes.Length)): $($printOutcome.Message)" `
        -Stage $stage -Win32Error $winErr -ResolvedPrinter $resolvedName -DriverName $driverName -PortName $portName `
        -PrinterStatus $printerStatusStr -WorkOffline $workOffline -SpoolerStatus $spoolerStatus `
        -BytesSent $printOutcome.BytesWritten -InstalledPrinters $installedNames -ExitCode 2
}

Write-ResultAndExit -Ok $true -Stage "Completed" -ResolvedPrinter $resolvedName `
    -DriverName $driverName -PortName $portName -PrinterStatus $printerStatusStr `
    -WorkOffline $workOffline -SpoolerStatus $spoolerStatus -BytesSent $printOutcome.BytesWritten `
    -InstalledPrinters $installedNames -ExitCode 0
