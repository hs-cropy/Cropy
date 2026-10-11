import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/offline/app.mjs',import.meta.url),'utf8')).replaceAll('\r\n','\n');
function setup(){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',classList:{toggle(){}},addEventListener(){}});return nodes.get(id);};
 const result={disease_name:'test',confidence:1,decision_reasons:[],top_predictions:[],causes:[],prevention:[],recapture:null};
 const context=vm.createContext({$,escape:String,busy:false,current:null,selected:{name:'new.jpg'},bundle:{version:'v1'},
 crypto:{randomUUID:()=> 'new-record'},setBusy(v){context.busy=v;},async predict(){return [];},summarize(){return result;},
 async storeRecord(record){context.result(record);return true;},message:e=>e.message});
 vm.runInContext(source.slice(source.indexOf('function result('),source.indexOf('async function storeRecord('))+
 source.slice(source.indexOf('async function diagnose('),source.indexOf('async function refine(')),context);
 return {context,$,record:id=>({id,result,saved:true})};
}
test('switching records clears the previous second photo',()=>{
 const h=setup();h.context.result(h.record('old'));h.$('second').value='old-second.jpg';
 h.context.result(h.record('new'));assert.equal(h.$('second').value,'');
});
test('rendering the same record preserves its selected second photo',()=>{
 const h=setup();h.context.result(h.record('same'));h.$('second').value='selected.jpg';
 h.context.result(h.record('same'));assert.equal(h.$('second').value,'selected.jpg');
});
test('starting a diagnosis clears the second photo even if inference fails',async()=>{
 const h=setup();h.context.result(h.record('old'));h.$('second').value='old-second.jpg';
 h.context.predict=async()=>{throw new Error('inference failed');};await h.context.diagnose();
 assert.equal(h.$('second').value,'');
});
