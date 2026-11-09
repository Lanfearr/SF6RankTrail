import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Match, MatchResult, RatingPoint } from '@shared/types'
import { characterIconSrc } from '../lib/characterIcons'
import { formatDelta } from '../lib/format'
import { seriesKey } from '../lib/ratings'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer
])

type ChartOption = Parameters<ReturnType<typeof echarts.init>['setOption']>[0]

interface Props {
  points: RatingPoint[]
  kind: 'MR' | 'LP'
  matches: Match[]
  deltas: ReadonlyMap<number, number>
}

interface ChartIcon {
  key: string
  left: number
  top: number
  size: number
  src: string
  label: string
  result: MatchResult
  delta: number | null
}

interface TooltipParam {
  dataIndex?: number
  value?: unknown
}

interface ZoomModel {
  getPercentRange?: () => number[]
}

const readZoomRange = (chart: ReturnType<typeof echarts.init>): [number, number] | null => {
  const model = (
    chart as unknown as {
      getModel: () =>
        | { getComponent: (name: string) => ZoomModel | ZoomModel[] | undefined }
        | undefined
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

const GRID_LEFT = 56
const GRID_RIGHT = 20
const GRID_BOTTOM = 24
const ICON_SPACING = 24

const resultLabel = (result: MatchResult): string =>
  result === 'win' ? '胜' : result === 'loss' ? '负' : '平'

export function TrendChart({ points, kind, matches, deltas }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)
  const iconsUpdateRef = useRef<() => void>(() => undefined)
  const [chartIcons, setChartIcons] = useState<ChartIcon[]>([])
  const seriesCount = new Set(points.map((point) => point.character ?? '未知角色')).size

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, 'dark', { renderer: 'canvas' })
    chartRef.current = chart

    const observer = new ResizeObserver(() => {
      chart.resize()
      requestAnimationFrame(() => iconsUpdateRef.current())
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const groups = new Map<string, number>()
    for (const point of points) {
      const name = point.character ?? '未知角色'
      groups.set(name, (groups.get(name) ?? 0) + 1)
    }
    const multi = groups.size > 1
    const gridTop = multi ? 48 : 28

    const labels = points.map((_, index) => `#${index + 1}`)

    const matchesBySeries = new Map<string, Match>()
    for (const match of matches) {
      matchesBySeries.set(seriesKey(match.myChar, match.playedAt), match)
    }

    const matchByPointId = new Map<number, Match>()
    const matchNumberByPointId = new Map<number, number>()
    let matchNumber = 0
    for (const point of points) {
      const match = matchesBySeries.get(seriesKey(point.character, point.observedAt))
      if (!match) continue
      matchNumber += 1
      matchByPointId.set(point.id, match)
      matchNumberByPointId.set(point.id, matchNumber)
    }

    const series = [...groups.keys()].map((name) => ({
      name,
      type: 'line' as const,
      showSymbol: points.length <= 2,
      smooth: true,
      connectNulls: true,
      data: points.map((point) => ((point.character ?? '未知角色') === name ? point.value : null)),
      areaStyle: multi ? undefined : { opacity: 0.16 },
      lineStyle: { width: multi ? 1.8 : 2, color: multi ? undefined : '#f59e0b' },
      emphasis: { focus: 'series' as const }
    }))

    const [zoomStart, zoomEnd] = readZoomRange(chart) ?? [0, 100]

    const option: ChartOption = {
      backgroundColor: 'transparent',
      color: [
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
      ],
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
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: gridTop, bottom: GRID_BOTTOM },
      tooltip: {
        trigger: 'axis',
        formatter: (params: TooltipParam | TooltipParam[]) => {
          const list = Array.isArray(params) ? params : [params]
          const first =
            list.find((item) => item.value !== null && item.value !== undefined) ?? list[0]
          const point = points[first?.dataIndex ?? -1]
          if (!point) return ''
          const match = matchByPointId.get(point.id)
          const lines = [
            `第 ${matchNumberByPointId.get(point.id) ?? (first?.dataIndex ?? 0) + 1} 场`,
            `${point.character ?? '未知角色'} ${kind} ${point.value.toLocaleString()}`,
            new Date(point.observedAt).toLocaleString()
          ]
          if (match) lines.splice(2, 0, `对手 ${match.oppChar ?? '?'} · ${resultLabel(match.result)}`)
          return lines.join('<br/>')
        }
      },
      xAxis: {
        type: 'category',
        name: '场次',
        boundaryGap: false,
        data: labels,
        axisLabel: {
          interval: 'auto',
          rotate: 0,
          margin: 6,
          fontSize: 10,
          color: '#9ca3af',
          hideOverlap: true
        },
        axisLine: { lineStyle: { color: '#555' } }
      },
      yAxis: { type: 'value', scale: true, name: kind },
      dataZoom: [{ type: 'inside', start: zoomStart, end: zoomEnd }],
      series
    }

    let frame = 0
    const updateIcons = (): void => {
      const width = chart.getWidth()
      const height = chart.getHeight()
      if (width <= 0 || height <= 0 || points.length === 0) {
        setChartIcons([])
        return
      }

      const [start, end] = readZoomRange(chart) ?? [0, 100]
      const startIndex = (start / 100) * Math.max(0, points.length - 1)
      const endIndex = (end / 100) * Math.max(0, points.length - 1)
      const span = endIndex - startIndex
      const plotWidth = width - GRID_LEFT - GRID_RIGHT

      const makeIcon = (
        point: RatingPoint,
        match: Match,
        index: number,
        left: number,
        size: number
      ): void => {
        const src = characterIconSrc(match.oppChar)
        if (!src) return
        const rawY = chart.convertToPixel({ yAxisIndex: 0 }, point.value)
        const y = Number(Array.isArray(rawY) ? rawY[1] : rawY)
        if (!Number.isFinite(y) || y < gridTop || y > height - GRID_BOTTOM) return
        next.push({
          key: `${point.id}-${match.replayId}-${index}`,
          left,
          top: y,
          size,
          src,
          label: match.oppChar ?? '对手',
          result: match.result,
          delta: deltas.get(match.playedAt) ?? null
        })
      }

      const next: ChartIcon[] = []
      if (span <= 0) {
        const index = Math.max(0, Math.min(points.length - 1, Math.round(startIndex)))
        const point = points[index]
        const match = point ? matchByPointId.get(point.id) : undefined
        if (point && match) makeIcon(point, match, index, GRID_LEFT + plotWidth / 2, 28)
        setChartIcons(next)
        return
      }

      const spacing = plotWidth / span
      if (spacing < ICON_SPACING) {
        setChartIcons([])
        return
      }

      const size = Math.max(18, Math.min(30, spacing * 0.72))
      const firstIndex = Math.ceil(startIndex)
      const lastIndex = Math.floor(endIndex)

      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const point = points[index]
        if (!point) continue
        const match = matchByPointId.get(point.id)
        if (!match) continue
        makeIcon(
          point,
          match,
          index,
          GRID_LEFT + ((index - startIndex) / span) * plotWidth,
          size
        )
      }

      setChartIcons(next)
    }

    const scheduleIcons = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateIcons)
    }

    setChartIcons([])
    chart.setOption(option, true)
    iconsUpdateRef.current = scheduleIcons
    scheduleIcons()
    chart.on('datazoom', scheduleIcons)
    chart.on('finished', scheduleIcons)

    return () => {
      cancelAnimationFrame(frame)
      chart.off('datazoom', scheduleIcons)
      chart.off('finished', scheduleIcons)
      if (iconsUpdateRef.current === scheduleIcons) iconsUpdateRef.current = () => undefined
    }
  }, [points, kind, matches, deltas])

  return (
    <div
      className="chart-wrap"
      data-point-count={points.length}
      data-series-count={seriesCount}
      data-icon-count={chartIcons.length}
      data-delta-count={chartIcons.filter((icon) => icon.delta !== null).length}
    >
      <div className="chart" ref={containerRef} />
      <div className="chart-icons">
        {chartIcons.map((icon) => (
          <span
            key={icon.key}
            className={`chart-icon ${icon.result}`}
            style={{
              left: icon.left,
              top: icon.top,
              width: icon.size,
              height: icon.size
            }}
            title={`${icon.label} · ${resultLabel(icon.result)}`}
          >
            <img src={icon.src} alt={icon.label} draggable={false} />
            {icon.delta !== null && (
              <span className={`chart-delta ${icon.result}`}>{formatDelta(icon.delta)}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
