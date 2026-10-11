/* Dashboard-owned chart style; data stays with the existing analytics model. */
(() => {
  'use strict';
  const colors=['#278560','#4b9da7','#8b7ac7','#c79b46','#ce7d78','#7caa9f'];
  const family='Plus Jakarta Sans, system-ui, sans-serif';
  function options(){
    return {responsive:true,maintainAspectRatio:false,
      animation:matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:350,easing:'easeOutQuart'},
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:7,boxHeight:7,padding:16,font:{size:11,weight:550,family}}},
        tooltip:{backgroundColor:'#183e30',titleColor:'#fff',bodyColor:'#e2eee6',padding:13,cornerRadius:11,
          boxPadding:5,usePointStyle:true,titleFont:{size:12,weight:650,family},bodyFont:{size:12,family}}}};
  }
  function scales(){return {
    x:{border:{display:false},grid:{display:false},ticks:{maxRotation:0,maxTicksLimit:8,font:{size:11,family},color:'#7b8d82'}},
    y:{beginAtZero:true,border:{display:false},grid:{color:'#e8efe9',drawTicks:false},ticks:{precision:0,padding:9,font:{size:11,family},color:'#7b8d82'}}
  };}
  function area(context){
    const {chart}=context,box=chart.chartArea;if(!box)return '#27856012';
    const gradient=chart.ctx.createLinearGradient(0,box.top,0,box.bottom);gradient.addColorStop(0,'#2785602d');gradient.addColorStop(1,'#27856000');return gradient;
  }
  window.PGENRO_ChartStyle={colors,options,scales,area};
  if(!window.Chart)return;
  window.Chart.defaults.font.family=family;window.Chart.defaults.font.size=11;window.Chart.defaults.color='#758b7d';
  Object.assign(window.Chart.defaults.plugins.tooltip,options().plugins.tooltip);
  window.Chart.register({id:'pgenroDoughnutTotal',afterDraw(chart){
    if(chart.config.type!=='doughnut'||!chart.chartArea)return;
    const sum=(chart.data.datasets[0]?.data||[]).reduce((total,value,index)=>total+(chart.getDataVisibility(index)?Number(value)||0:0),0);
    const {left,right,top,bottom}=chart.chartArea,x=(left+right)/2,y=(top+bottom)/2,ctx=chart.ctx;
    const radius=chart.getDatasetMeta(0).data[0]?.innerRadius||45;
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=getComputedStyle(chart.canvas).getPropertyValue('--chart-total-color').trim()||'#244d39';
    ctx.font=`750 ${Math.min(32,Math.max(19,radius*.6))}px ${family}`;
    ctx.fillText(new Intl.NumberFormat(undefined,{notation:sum>=10000?'compact':'standard',maximumFractionDigits:1}).format(sum),x,y-6);
    ctx.fillStyle='#84988b';ctx.font=`550 10px ${family}`;ctx.fillText('TOTAL RECORDS',x,y+18);ctx.restore();
  }});
})();
