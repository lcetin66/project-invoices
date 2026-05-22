// PieChart.tsx - Reusable SVG pie chart component
import React from "react";

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieSlice[];
  radius?: number; // radius in pixels
  innerRadius?: number; // for donut style
}

/**
 * Simple SVG pie (or donut) chart.
 * Expects data array sorted descending for visual priority.
 */
export const PieChart: React.FC<PieChartProps> = ({ data, radius = 80, innerRadius = 0 }) => {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const viewBoxSize = radius * 2;
  let cumulative = 0;

  const slices = data.map((slice, idx) => {
    const startAngle = (cumulative / total) * 360;
    const sliceAngle = (slice.value / total) * 360;
    cumulative += slice.value;
    const endAngle = (cumulative / total) * 360;

    // Convert polar to cartesian for arc end point
    const largeArcFlag = sliceAngle > 180 ? 1 : 0;
    const startX = radius + radius * Math.cos(((startAngle - 90) * Math.PI) / 180);
    const startY = radius + radius * Math.sin(((startAngle - 90) * Math.PI) / 180);
    const endX = radius + radius * Math.cos(((endAngle - 90) * Math.PI) / 180);
    const endY = radius + radius * Math.sin(((endAngle - 90) * Math.PI) / 180);

    const pathData =
      innerRadius > 0
        ? // Donut chart path (outer arc + inner arc)
          `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} L ${radius + innerRadius * Math.cos(((endAngle - 90) * Math.PI) / 180)} ${radius + innerRadius * Math.sin(((endAngle - 90) * Math.PI) / 180)} A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${radius + innerRadius * Math.cos(((startAngle - 90) * Math.PI) / 180)} ${radius + innerRadius * Math.sin(((startAngle - 90) * Math.PI) / 180)} Z`
        : // Full pie slice
          `M ${radius} ${radius} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;

    return (
      <path key={idx} d={pathData} fill={slice.color} stroke="#fff" strokeWidth={1} />
    );
  });

  return (
    <svg width={viewBoxSize} height={viewBoxSize} viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}>
      {slices}
    </svg>
  );
};

export default PieChart;
