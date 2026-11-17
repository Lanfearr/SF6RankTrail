import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { CustomChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { CustomSeriesRenderItemAPI, CustomSeriesRenderItemParams } from 'echarts'
import type { RatingPoint } from '@shared/types'
import {
  buildBoxSamples,
  buildCharacterBoxPeriods,
  formatBoxAxisLabel,
  formatBoxPeriodTitle,
  selectBoxUnit,
  type BoxMetric,
  type BoxUnit
} from '../lib/boxplot'

echarts.use([
  CustomChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer
])

type ChartOption = Parameters<ReturnType<typeof echarts.init>['setOption']>[0]

interface Props {
  points: RatingPoint[]
  ratingPoints: RatingPoint[]
  kind: 'MR' | 'LP'
  metric: BoxMetric
  onUnitChange?: (unit: BoxUnit) => void
}

interface ZoomModel {
  getPercentRange?: () => number[]
}

interface BoxTooltipParam {
  seriesName?: string
  value?: unknown
}

const GRID_LEFT = 56
const GRID_RIGHT = 20
const GRID_BOTTOM_WITH_SLIDER = 56
const ZOOM_DEBOUNCE_MS = 120
const PALETTE = [
  '#f59e0b',
  '#38bdf8',
  '#a78bfa',
  '#fb7185',
  '#34d399',
  '#facc15',
  '#22d3ee',
  '#f472b6',
  '#a3e635',
  '#fb923c'
]

const readZoomRange = (chart: ReturnType<typeof echarts.init>): [number, number] | null => {
  const model = (
    chart as unknown as {
      getModel: () =>
        { getComponent: (name: string) => ZoomModel | ZoomModel[] | undefined } | undefined
    }
  ).getModel()
  if (!model) return null
  const component = model.getComponent('dataZoom')
  const components = Array.isArray(component) ? component : component ? [component] : []

  for (const item of components) {
    const range = item.getPercentRange?.()
    if (!range || range.length < 2) continue
    const start = Math.max(0, Math.min(100, range[0] ?? 0))
    const end = Math.max(0, Math.min(100, range[1] ?? 100))
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return [start, end]
  }
  return null
}

const withAlpha = (color: string, alpha: number): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return color
  return `#${match[1]}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`
}

const renderBox = (_params: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
  const value = (dimension: number): number => Number(api.value(dimension))
  const count = value(6)
  const characterIndex = value(7)
  const characterCount = Math.max(1, value(8))
  const periodStart = value(9)
  const periodEnd = value(10)

  const x = Number(api.coord([value(0), value(1)])[0])
  const startX = Number(api.coord([periodStart, value(1)])[0])
  const endX = Number(api.coord([periodEnd, value(1)])[0])
  const yMin = Number(api.coord([value(0), value(1)])[1])
  const yQ1 = Number(api.coord([value(0), value(2)])[1])
  const yMedian = Number(api.coord([value(0), value(3)])[1])
  const yQ3 = Number(api.coord([value(0), value(4)])[1])
  const yMax = Number(api.coord([value(0), value(5)])[1])

  const slotWidth = (Math.max(1, endX - startX) * 0.72) / characterCount
  const boxWidth = Math.max(2, Math.min(22, slotWidth * 0.78))
  const offset = (characterIndex - (characterCount - 1) / 2) * slotWidth
  const centerX = x + offset
  const left = centerX - boxWidth / 2
  const cap = Math.max(1.5, boxWidth * 0.34)
  const color = String(api.visual('color') ?? '#f59e0b')
  const lineStyle = { stroke: color, lineWidth: 1, opacity: 0.9 }
  const children: Array<Record<string, unknown>> = []

  if (count <= 1) {
    children.push({
      type: 'circle',
      shape: { cx: centerX, cy: yMedian, r: Math.max(2, boxWidth * 0.22) },
      style: { fill: color, stroke: color, lineWidth: 1 }
    })
  } else {
    if (yQ3 < yMin) {
      children.push({
        type: 'line',
        shape: { x1: centerX, x2: centerX, y1: yMin, y2: yQ1 },
        style: lineStyle
      })
    }
    if (yMax < yQ3) {
      children.push({
        type: 'line',
        shape: { x1: centerX, x2: centerX, y1: yQ3, y2: yMax },
        style: lineStyle
      })
    }
    children.push({
      type: 'line',
      shape: { x1: centerX - cap, x2: centerX + cap, y1: yMin, y2: yMin },
      style: lineStyle
    })
    children.push({
      type: 'line',
      shape: { x1: centerX - cap, x2: centerX + cap, y1: yMax, y2: yMax },
      style: lineStyle
    })
    children.push({
      type: 'rect',
      shape: {
        x: left,
        y: yQ3,
        width: boxWidth,
        height: Math.max(1, yQ1 - yQ3)
      },
      style: { fill: withAlpha(color, 0.18), stroke: color, lineWidth: 1.2 }
    })
    children.push({
      type: 'line',
      shape: { x1: left, x2: left + boxWidth, y1: yMedian, y2: yMedian },
      style: { stroke: color, lineWidth: 1.4 }
    })
  }

  return { type: 'group', children }
}

const formatNumber = (value: number, metric: BoxMetric): string => {
  const rounded = Math.round(value * 10) / 10
  const safe = Object.is(rounded, -0) ? 0 : rounded
  return `${metric === 'delta' && safe > 0 ? '+' : ''}${safe.toLocaleString(undefined, {
    maximumFractionDigits: 1
  })}`
}

export function RatingBoxPlot({ points, ratingPoints, kind, metric, onUnitChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const axisRef = useRef<{ min: number; max: number } | null>(null)
  const windowRef = useRef<{ start: number; end: number } | null>(null)
  const applyingRef = useRef(false)
  const zoomTimerRef = useRef<number | null>(null)

  const samples = useMemo(
    () => buildBoxSamples(points, ratingPoints, metric),
    [points, ratingPoints, metric]
  )
  const sampleSpan = useMemo(() => {
    if (samples.length === 0) return 0
    let min = samples[0]?.at ?? 0
    let max = min
    for (const sample of samples) {
      if (sample.at < min) min = sample.at
      if (sample.at > max) max = sample.at
    }
    return max - min
  }, [samples])
  const [unit, setUnit] = useState<BoxUnit>(() => selectBoxUnit(sampleSpan))
  const characterPeriods = useMemo(() => buildCharacterBoxPeriods(samples, unit), [samples, unit])
  const axis = useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const series of characterPeriods) {
      for (const period of series.periods) {
        if (period.start < min) min = period.start
        if (period.end > max) max = period.end
      }
    }
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null
  }, [characterPeriods])
  const boxCount = characterPeriods.reduce((sum, series) => sum + series.periods.length, 0)
  const unitRef = useRef(unit)

  useEffect(() => {
    unitRef.current = unit
    onUnitChange?.(unit)
  }, [unit, onUnitChange])

  useEffect(() => {
    if (!windowRef.current && sampleSpan > 0) setUnit(selectBoxUnit(sampleSpan))
  }, [sampleSpan])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, 'dark', { renderer: 'canvas' })
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container)

    const handleZoom = (): void => {
      if (applyingRef.current) return
      const currentAxis = axisRef.current
      if (!currentAxis) return
      const range = readZoomRange(chart)
      if (!range) return
      const span = currentAxis.max - currentAxis.min
      const visibleStart = currentAxis.min + (range[0] / 100) * span
      const visibleEnd = currentAxis.min + (range[1] / 100) * span
      if (!(visibleEnd > visibleStart)) return
      windowRef.current = { start: visibleStart, end: visibleEnd }
      if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = window.setTimeout(() => {
        const nextUnit = selectBoxUnit(visibleEnd - visibleStart)
        if (nextUnit !== unitRef.current) setUnit(nextUnit)
      }, ZOOM_DEBOUNCE_MS)
    }

    chart.on('datazoom', handleZoom)

    return () => {
      observer.disconnect()
      chart.off('datazoom', handleZoom)
      if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (!axis) {
      axisRef.current = null
      chart.clear()
      return
    }

    axisRef.current = axis
    const axisSpan = axis.max - axis.min
    let window = windowRef.current
    if (window && (window.end <= axis.min || window.start >= axis.max)) window = null
    if (window) {
      window = {
        start: Math.max(axis.min, window.start),
        end: Math.min(axis.max, window.end)
      }
      windowRef.current = window
    }
    const startPct = window ? ((window.start - axis.min) / axisSpan) * 100 : 0
    const endPct = window ? ((window.end - axis.min) / axisSpan) * 100 : 100
    const multi = characterPeriods.length > 1
    const gridTop = multi ? 48 : 28

    const option: ChartOption = {
      backgroundColor: 'transparent',
      animation: false,
      color: PALETTE,
      legend: multi
        ? {
            type: 'scroll',
            top: 0,
            left: 0,
            right: 0,
            itemWidth: 10,
            itemHeight: 8,
            textStyle: { fontSize: 10, color: '#9ca3af' }
          }
        : undefined,
      grid: {
        left: GRID_LEFT,
        right: GRID_RIGHT,
        top: gridTop,
        bottom: GRID_BOTTOM_WITH_SLIDER
      },
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params]
          const first = list[0] as BoxTooltipParam | undefined
          const values = Array.isArray(first?.value) ? first.value.map(Number) : []
          if (values.length < 12) return ''
          const min = values[1] ?? 0
          const q1 = values[2] ?? 0
          const median = values[3] ?? 0
          const q3 = values[4] ?? 0
          const max = values[5] ?? 0
          const count = values[6] ?? 0
          const start = values[9] ?? 0
          const end = values[10] ?? 0
          const mean = values[11] ?? 0
          return [
            `${formatBoxPeriodTitle(start, end, unit)} · ${first?.seriesName ?? '未知角色'}`,
            `样本 ${count} 场`,
            `中位 ${formatNumber(median, metric)}`,
            `Q1 ${formatNumber(q1, metric)} · Q3 ${formatNumber(q3, metric)}`,
            `范围 ${formatNumber(min, metric)} ~ ${formatNumber(max, metric)}`,
            `均值 ${formatNumber(mean, metric)}`
          ].join('<br/>')
        }
      },
      xAxis: {
        type: 'time',
        axisLabel: {
          formatter: (value: number | string) => formatBoxAxisLabel(Number(value), unit),
          fontSize: 10,
          color: '#9ca3af',
          hideOverlap: true
        },
        axisLine: { lineStyle: { color: '#555' } }
      },
      yAxis: {
        type: 'value',
        scale: true,
        name: metric === 'delta' ? `${kind} 变化` : kind
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          start: startPct,
          end: endPct,
          filterMode: 'weakFilter'
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          start: startPct,
          end: endPct,
          left: GRID_LEFT,
          right: GRID_RIGHT,
          bottom: 8,
          height: 16,
          showDetail: false,
          brushSelect: false,
          showDataShadow: false,
          borderColor: 'transparent',
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          fillerColor: 'rgba(245, 158, 11, 0.16)',
          handleSize: 10,
          handleStyle: { color: '#f59e0b', borderColor: '#f59e0b' }
        }
      ],
      series: characterPeriods.map((entry, index) => ({
        name: entry.character,
        type: 'custom' as const,
        renderItem: renderBox,
        clip: true,
        encode: { x: [9, 10], y: [1, 2, 3, 4, 5] },
        data: entry.periods.map((period) => [
          period.center,
          period.min,
          period.q1,
          period.median,
          period.q3,
          period.max,
          period.count,
          index,
          characterPeriods.length,
          period.start,
          period.end,
          period.mean
        ]),
        itemStyle: { color: PALETTE[index % PALETTE.length] },
        z: 3
      }))
    }

    applyingRef.current = true
    chart.setOption(option, true)
    const frame = requestAnimationFrame(() => {
      applyingRef.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [axis, characterPeriods, kind, metric, unit])

  return (
    <div
      className="chart-wrap"
      data-point-count={points.length}
      data-chart-mode="box"
      data-box-metric={metric}
      data-box-unit={unit}
      data-box-count={boxCount}
      data-series-count={characterPeriods.length}
      data-sample-count={samples.length}
      data-zoom-slider="true"
    >
      <div className="chart" ref={containerRef} />
      {samples.length === 0 && (
        <div className="chart-empty">
          <strong>暂无可计算的分数变化</strong>
          <span>所选范围内还没有足够的评分点。</span>
        </div>
      )}
    </div>
  )
}
