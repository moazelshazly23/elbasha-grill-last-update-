/**
 * Electron & Windows IPC Type Definitions
 * Mosawyat Al Basha Commercial POS
 */

export interface SystemInfo {
  os: string;
  arch: string;
  appVersion: string;
  userDataPath: string;
  dataDir: string;
  logsDir: string;
  backupsDir: string;
  sqliteFile: string;
  isWindows: boolean;
  isElevated: boolean;
}

export interface PrintOptions {
  html: string;
  printerName?: string;
  paperWidth?: '80mm' | '58mm' | 'a4';
  silent?: boolean;
  copies?: number;
  openDrawer?: boolean;
  cutPaper?: boolean;
  margins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
}

export interface PrintResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  technicalDetails?: string;
  printerUsed?: string;
}

export type KitchenProtocolMode = 'escpos_raster' | 'escpos_text' | 'plain_line' | 'windows_driver';

export interface RawEscPosOptions {
  target: 'cashier_usb' | 'kitchen_lan';
  printerName?: string;
  ip?: string;
  port?: number;
  escposBase64?: string;
  rawText?: string;
  kitchenProtocol?: KitchenProtocolMode;
  paperWidth?: '80mm' | '58mm';
  copies?: number;
  autoCut?: boolean;
  buzzer?: boolean;
  paperFeedLines?: number;
  timeoutMs?: number;
}

export interface RawEscPosResult {
  success: boolean;
  mode?: string;
  bytesSent?: number;
  printerUsed?: string;
  portName?: string;
  driverName?: string;
  printerStatus?: string;
  spoolerStatus?: string;
  error?: string;
  errorCode?: string;
  technicalDetails?: string;
}

export interface TestConnectionOptions {
  target: 'cashier_usb' | 'kitchen_lan';
  printerName?: string;
  ip?: string;
  port?: number;
  timeoutMs?: number;
  checkType?: 'network' | 'port' | 'usb_spooler';
}

export interface TestConnectionResult {
  success: boolean;
  reachable: boolean;
  details: string;
  errorCode?: string;
  technicalDetails?: string;
  resolvedPrinter?: string;
  driverName?: string;
  portName?: string;
  printerStatus?: string;
  spoolerStatus?: string;
  installedPrinters?: string[];
  latencyMs?: number;
}

export interface PrinterDevice {
  name: string;
  displayName: string;
  description: string;
  status: number;
  isDefault: boolean;
}

export interface SQLitePathPayload {
  filePath?: string;
  directory?: string;
}

export interface SQLitePathResult {
  success: boolean;
  resolvedPath: string;
  dataDir: string;
  exists: boolean;
  error?: string;
}

export interface SQLiteSnapshotPayload {
  tableName: string;
  data: string;
  targetPath?: string;
}

export interface AppDataPayload {
  key: string;
  data: string;
}
