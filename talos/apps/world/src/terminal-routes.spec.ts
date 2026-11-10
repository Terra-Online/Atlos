// @vitest-environment node
import {test,expect} from 'vitest';
import {selectTerminal,joinTerminal,type Catalog} from '../terminal-routes';
import type {Route} from '@opendfieldmap/ganglia';
type Complete=Extract<Route,{status:'complete'}>;
const source={buildGuid:'b',contentHash:'h'},interaction={radius:1,airborne:true};
const tail:Complete={status:'complete',start:'entry',cost:1,arrivalCost:0,length:3,points:[[1,0,0],[2,2,0],[3,1,0]],
 segments:[{mode:'jump',points:[[1,0,0],[2,2,0],[3,1,0]],times:[0,.5,1]}],goalHit:{segment:0,time:1,position:[3,1,0]}};
const catalog:Catalog={version:1,exportRevision:2,source,generator:'g',solver:'v',movementHash:'m',
 routes:[{id:'a',scene:'scene',target:[3,1,0],interaction,route:tail}]};
const context={scene:'scene',source,generator:'g',solver:'file:ganglia-v.tgz',movementHash:'m',target:[3,1,0] as [number,number,number],
 interaction,arrivals:[{id:'tp',state:'available' as const,cost:0,position:[0,0,0] as [number,number,number]}],speed:5};
test('terminal selection follows the goal and exact resource/model binding without point-specific rules',()=>{
 expect(selectTerminal(catalog,context)?.id).toBe('a');
 expect(selectTerminal(catalog,{...context,generator:'old'})).toBeNull();
 expect(selectTerminal(catalog,{...context,movementHash:'old'})).toBeNull();
 expect(selectTerminal(catalog,{...context,interaction:{radius:2,airborne:true}})).toBeNull();
 expect(selectTerminal(catalog,{...context,target:[30,1,0]})).toBeNull();
});
test('the prefix joins the physically proven entry and retains the airborne collection event',()=>{
 const prefix:Complete={status:'complete',start:'tp',arrivalCost:0,cost:1,length:1,points:[[0,0,0],[1,0,0]],
 segments:[{mode:'walk',points:[[0,0,0],[1,0,0]],times:[0,1]}]};
 const result=joinTerminal(prefix,tail,{speed:1,sprintSpeed:1,sprintAcceleration:1});
 expect(result.status).toBe('complete');
 if(result.status==='complete'){
  expect(result.start).toBe('tp');expect(result.cost).toBe(2);
  expect(result.goalHit?.segment).toBe(1);expect(result.goalHit?.position).toEqual([3,1,0]);
 }
 expect(joinTerminal({...prefix,points:[[0,0,0],[1,1,0]]},tail,{speed:1,sprintSpeed:1,sprintAcceleration:1}).status).toBe('no-verified-route');
});
