/**
 * Explainable, conservative screen of Weinstein stages.
 * The quantitative stage model remains heuristic and not a trade instruction.
 * Do not turn phase-1 watch entries into buys.
 */
export function explainSetup(scan){
 const errors=[];
 if(scan.signal==='INSUFFICIENT_HISTORY')return {signal:scan.signal,eligible:false,stage:'DATA_UNAVAILABLE',reasons:['Moins de 40 semaines clôturées'],stageRank:99,setupScore:0};
 if(scan.signal==='INSUFFICIENT_BENCHMARK'||scan.relativeStrength===null)
  return {signal:'INSUFFICIENT_BENCHMARK',eligible:false,stage:'DATA_UNAVAILABLE',reasons:['Force relative impossible : référence absente ou insuffisante'],stageRank:99,setupScore:0};
 if(!scan.breakout)errors.push('Pas de cassure de la résistance des 26 semaines');
 if(!scan.aboveMa)errors.push('Cours inférieur à la MM30');
 if(!scan.rising)errors.push('MM30 pas assez haussière');
 if(!(scan.volumeRatio>=1.5))errors.push('Volume inférieur à 1,5× la moyenne');
 if(!(scan.relativeStrength>0))errors.push('Force relative non positive');
 if(!scan.hasBaseForBreakout)errors.push('Base de 12 semaines absente ou trop volatile (>30 %)');

 const extensionPct=Number.isFinite(scan.ma30)&&scan.ma30>0&&scan.priorHigh>0
  ? null:null;
 // For confirmed breakouts, evaluate the closing price relative to the MM30,
 // not the breakout resistance. Reconstruct closing price via the last close
 // supplied by the scanner in the API, rather than using an invented quote.
 const close=scan.lastClose;
 const distanceFromMaPct=Number.isFinite(close)&&scan.ma30>0
  ?(close/scan.ma30-1)*100:null;
 const extended=scan.eligible===true&&distanceFromMaPct!==null&&distanceFromMaPct>20;
 if(extended)errors.push('Hausse déjà étendue : cours à plus de 20 % de la MM30');
 const confirmed=scan.eligible===true&&!extended;
 const signal=extended?'PHASE2_EXTENDED':scan.signal;
 const stage=extended?'PHASE2_ADVANCED':scan.stage;
 const stageRank=extended?4:(scan.stageRank??98);
 return {signal,stage,stageRank,setupScore:extended?0:(scan.setupScore??0),eligible:confirmed,
  distanceFromMaPct,reasons:confirmed?['Cassure hebdomadaire, force relative, base et volumes confirmés']:
  signal==='PHASE1_LATE'?['Fin de phase 1 : surveillance uniquement; cassure non confirmée',...errors]:
  signal==='PHASE1_BASE'?['Base en formation : ne pas anticiper un achat',...errors]:
  errors.length?errors:['Aucune configuration exploitable']};
}
