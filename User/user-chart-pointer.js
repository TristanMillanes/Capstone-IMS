/* Canvas-local cursor positioning. No page transforms or data changes. */
(() => {
  'use strict';
  const Chart=window.Chart;
  if(!Chart?.Tooltip?.positioners||Chart.__pgenroCursorReady)return;
  Chart.Tooltip.positioners.pgenroCursor=function(elements,position){
    if(!elements.length||!Number.isFinite(position?.x)||!Number.isFinite(position?.y))return false;
    return {x:position.x,y:position.y};
  };
  Chart.register({
    id:'pgenroCursorGuide',
    beforeEvent(chart,args){
      const event=args.event,native=event.native,point=native?.touches?.[0]||native?.changedTouches?.[0]||native;
      if(!Number.isFinite(point?.clientX)||!Number.isFinite(point?.clientY))return;
      const rect=chart.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
      // Match the displayed canvas, including CSS zoom and high-density screens.
      event.x=(point.clientX-rect.left)*chart.width/rect.width;
      event.y=(point.clientY-rect.top)*chart.height/rect.height;
      args.inChartArea=chart.isPointInArea(event);
    },
    afterDatasetsDraw(chart){
      if(!['line','bar'].includes(chart.config.type)||!chart.tooltip?.opacity)return;
      const {left,right,top,bottom}=chart.chartArea,x=chart.tooltip.caretX;
      if(!Number.isFinite(x)||x<left||x>right)return;
      const ctx=chart.ctx;ctx.save();ctx.beginPath();ctx.setLineDash([3,4]);ctx.lineWidth=1;ctx.strokeStyle='#267b5a55';ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();ctx.restore();
    }
  });
  Chart.__pgenroCursorReady=true;
  window.PGENRO_ChartPointerReady=true;
})();
