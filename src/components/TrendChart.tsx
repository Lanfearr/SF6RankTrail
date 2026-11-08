import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { RatingPoint } from '@shared/types'

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer])

type ChartOption = Parameters<ReturnType<typeof echarts.init>['setOption']>[0]

interface Props {
  points: RatingPoint[]
  kind: 'MR' | 'LP'
}

export function TrendChart({ points, kind }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container, 'dark', { renderer: 'canvas' })
    chartRef.current = chart

    const observer = new ResizeObserver(() => chart.resize())
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

    const data = points.map((point) => point.value)
    let previousDay = ''
    const labels = points.map((point) => {
      const date = new Date(point.observedAt)
      const day = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      if (day === previousDay) return ''
      previousDay = day
      return `${date.getMonth() + 1}/${date.getDate()}`
    })
    const option: ChartOption = {
      backgroundColor: 'transparent',
      grid: { left: 56, right: 20, top: 28, bottom: 72 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { dataIndex: number } | { dataIndex: number }[]) => {
          const first = Array.isArray(params) ? params[0] : params
          const point = points[first?.dataIndex ?? -1]
          if (!point) return ''
          return [
            `第 ${(first?.dataIndex ?? 0) + 1} 场`,
            `${kind} ${point.value.toLocaleString()}`,
            new Date(point.observedAt).toLocaleString()
          ].join('<br/>')
        }
      },
      xAxis: {
        type: 'category',
        name: '场次',
        boundaryGap: false,
        data: labels,
        axisLabel: {
          interval: 0,
          rotate: 30,
          margin: 10,
          fontSize: 10,
          color: '#9ca3af'
        },
        axisLine: { lineStyle: { color: '#555' } }
      },
      yAxis: { type: 'value', scale: true, name: kind },
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 18, bottom: 14, borderColor: 'transparent' }
      ],
      series: [
        {
          name: kind,
          type: 'line',
          showSymbol: false,
          smooth: true,
          data,
          areaStyle: { opacity: 0.16 },
          lineStyle: { width: 2, color: '#f59e0b' }
        }
      ]
    }

    chart.setOption(option, true)
  }, [points, kind])

  return <div className="chart" ref={containerRef} />
}
