import type { ChannelSetpoints } from '@shared/types'

/** Güç kaynağı sürücülerinin ortak arayüzü. Yeni cihaz türleri bunu uygular. */
export interface PsuDriver {
  readonly channelCount: number
  identify(): Promise<string>
  readChannel(ch: number): Promise<{ voltage: number; current: number; outputOn: boolean }>
  readSetpoints(ch: number): Promise<ChannelSetpoints>
  setVoltage(ch: number, volts: number): Promise<void>
  setCurrent(ch: number, amps: number): Promise<void>
  setOvp(ch: number, volts: number): Promise<void>
  setOcp(ch: number, amps: number): Promise<void>
  setOutput(ch: number, on: boolean): Promise<void>
  setAllOutputs(on: boolean): Promise<void>
  readLsr(ch: number): Promise<number>
  tripReset(): Promise<void>
  setTracking(on: boolean): Promise<void>
  readTracking(): Promise<boolean>
  readExecutionError(): Promise<number>
}
