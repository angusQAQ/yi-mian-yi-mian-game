const fs=require('fs'),vm=require('vm'),assert=require('assert'),crypto=require('crypto'),nodePath=require('path');
(async()=>{
 const sourceDir=process.argv[3]||nodePath.resolve(__dirname,'..');
 const htmlPath=process.argv[2]||nodePath.join(sourceDir,'build','yi-mian-yi-mian-offline.html');
 const html=fs.readFileSync(htmlPath,'utf8');
 assert(html.includes("connect-src 'none'"));
 assert(!/<script[^>]+src=|<link[^>]+stylesheet|<img[^>]+src="art\//.test(html));
 const script=html.match(/<script id="offline-game">([\s\S]*?)<\/script>/)[1];
 const imageData=html.match(/<script type="application\/json" id="offline-image-data">([\s\S]*?)<\/script>/)[1];
 assert(!/fetch\(|XMLHttpRequest|WebSocket|import\(/.test(script));
 let clock=0;const nodes=new Map(),blobs=[];
 function node(key){if(!nodes.has(key))nodes.set(key,{innerHTML:'',outerHTML:'',textContent:'',hidden:false,src:'',style:{setProperty(k,v){this[k]=v}},dataset:{},setAttribute(){},remove(){this.textContent=''},classList:{add(){},remove(){},toggle(){}}});return nodes.get(key)}
 node('#offline-image-data').textContent=imageData;
 const offlineOnly=()=>{throw Error('A standalone game attempted network access')};
 const context=vm.createContext({console,Blob,Uint8Array,atob,URL:{createObjectURL(blob){blobs.push(blob);return 'blob:offline-test-'+(blobs.length-1)}},performance:{now:()=>clock},Date,Math,Set,WeakMap,fetch:offlineOnly,XMLHttpRequest:offlineOnly,WebSocket:offlineOnly,Image:function(){throw Error('Offline race should not need image preloading')},setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},window:{scrollTo(){}},document:{body:{dataset:{}},documentElement:node('html'),querySelector:node,addEventListener(){}}});
 const run=code=>vm.runInContext(code,context);
 run(script);
 assert.equal(blobs.length,29);
 assert.equal(node('#offline-image-data').textContent,'');
 const urls=run('OFFLINE_URLS');
 for(const [name,url] of Object.entries(urls)){
  const blob=blobs[Number(url.split('-').at(-1))];
  const bytes=Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type,'image/png');
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(digest(bytes),digest(fs.readFileSync(nodePath.join(sourceDir,name))),name);
 }
 assert(node('#offline-brand-logo').src.startsWith('blob:'));
 assert(node('html').style['--offline-garden'].includes('blob:'));
 assert.equal(run('DATA.actions.length'),18);
 assert.equal(run('DATA.subjectlessQuestions.length'),4);
 assert(run('Object.values(ART).every(a=>a.file.startsWith("blob:"))'));
 assert(node('#app').innerHTML.includes('看圖判斷'));
 assert(!/src="art\/|url\('art\//.test(node('#app').innerHTML));
 run('startGuess()');assert.equal(run('guess.items.filter(q=>q.noSubject).length'),2);
 run('guess.items=[DATA.subjectlessQuestions[0]];guess.index=0;guess.answered=false;guess.choice=null;renderGuess();answerGuess(false)');
 assert(node('#app').innerHTML.includes('句子缺少主語。'));
 assert(node('#app').innerHTML.includes('補上主語'));
 run('startRace()');assert(!/圖片準備中|id="race-start-button"[^>]*disabled/.test(node('#app').innerHTML));
 run('startCountdown()');clock=3000;run('tickRace()');assert.equal(run('secondsLeft()'),60);
 const banks=run('RACE.players.map(p=>p.actions.map(a=>a.id))').map(b=>Array.from(b));
 assert.equal(banks[0].length,9);assert.equal(banks[1].length,9);
 assert.equal(banks[0].filter(a=>banks[1].includes(a)).length,0);
 for(let i=0;i<2;i++){
  let pair=null;for(const a of banks[i])for(const b of banks[i])if(!pair&&a!==b&&run(`pairRule('${a}','${b}').ok`))pair=[a,b];
  assert(pair);for(const id of [i?'brother':'mother','link',pair[0],'link',pair[1]])run(`chooseRaceWord(${i},'${id}')`);
  assert.equal(run(`RACE.players[${i}].score`),1);
 }
 clock=63000;run('tickRace()');assert.equal(run('RACE.phase'),'finished');
 assert.equal(run('reviewItems().length'),2);
 assert(node('#app').innerHTML.includes('本回合平手'));
 console.log('PASS: one HTML; no network APIs or external resources; 29 embedded images match original hashes; offline boot; two subjectless questions; instant race readiness; countdown; nine disjoint choices; both-player scoring; end-of-game review.');
})().catch(error=>{console.error(error);process.exitCode=1});
