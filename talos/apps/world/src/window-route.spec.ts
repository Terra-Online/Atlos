// @vitest-environment node
import { expect, test, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let directory: string, groundPath: string;
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'window-ground-'));
    groundPath = join(directory, 'ground.json');
    await writeFile(groundPath, JSON.stringify({ surfaces: [{ id: 'floor', vertices: [[0,0,-1],[201,0,-1],[201,0,1],[0,0,1]] }],
        options: { speed:5,maxVertical:0.1,walls:[],profile:{radius:0.1,height:1.8} } }));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
import { createWindowRoute } from '../window-route';
import type { RouteRequest } from '../physical-route-builder';
const request: RouteRequest = { scene: 'map02', source: { buildGuid: 'b', contentHash: 'c' },
    arrival: { id: 'a', position: [0, 0, 0], cost: 0, state: 'available' }, target: [200, 0, 0], walls: [] };
const settings = { maxTiles: 8, margin: 4, locomotion: { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 } };
test('windows retain true exits, enforce tile budget and retime the whole trajectory', async () => {
    const starts: number[][] = [];
    const builder: Parameters<typeof createWindowRoute>[0] = {
        query:  (_scene, _source, _start, _target, options) => {
            expect(options.corridor.tiles.length).toBeLessThanOrEqual(8);
            return Promise.resolve({ status: 'ready', message: '', output: groundPath, collision: 'collision' });
        },
        solve:  (_ground, local) => {
            starts.push(local.arrival.position);
            const exit = [...local.target] as [number, number, number];
            if (exit[0] !== 200) exit[0] -= 0.1;
            return Promise.resolve({ status: 'ready', message: '', output: 'route', collision: 'collision', result: { route: {
                status: 'complete', start: 'a', arrivalCost: 0, cost: 1, length: exit[0] - local.arrival.position[0],
                points: [local.arrival.position, exit], segments: [{ mode: 'walk', points: [local.arrival.position, exit], times: [0, 1] }],
            } } });
        },
    };
    const search = createWindowRoute(builder, request, [[40, 0, 0], [80, 0, 0], [120, 0, 0], [160, 0, 0], [200, 0, 0]], settings);
    let result = await search.advance();
    for (let i = 0; i < 20 && result.status === 'pending'; i++) result = await search.advance();
    expect(result.status).toBe('complete');
    expect(starts.length).toBeGreaterThan(1);
    expect(starts[1][0] % 40).toBeCloseTo(39.9);
    if (result.status === 'complete') expect(result.route.cost).toBeCloseTo(40);
});
test('target-side validation publishes only a partial route without validating the prefix', async () => {
    const starts: number[] = [];
    const builder: Parameters<typeof createWindowRoute>[0] = {
        query:  () => Promise.resolve(({ status: 'ready', message: '', output: groundPath, collision: 'collision' })),
        solve:  (_ground, local) => {
            starts.push(local.arrival.position[0]);
            return Promise.resolve({ status: 'ready', message: '', output: 'route', collision: 'collision', result: { route: {
                status: 'complete', start: local.arrival.id, arrivalCost: 0, cost: 1, length: local.target[0] - local.arrival.position[0],
                points: [local.arrival.position, local.target], segments: [{ mode: 'walk', points: [local.arrival.position, local.target], times: [0, 1] }],
            } } });
        },
    };
    const search = createWindowRoute(builder, request, [[40, 0, 0], [80, 0, 0], [120, 0, 0], [160, 0, 0], [200, 0, 0]], settings);
    let result = await search.advanceTail();
    for (let i = 0; i < 10 && result.status === 'pending'; i++) result = await search.advanceTail();
    expect(result.status).toBe('partial');
    expect(starts[0]).toBeGreaterThan(0);
    const prefix = await search.advance({ maxWindows: 0 });
    expect(prefix.status).toBe('incomplete');
    if (prefix.status === 'incomplete') expect(prefix.completedWindows).toBe(0);
});

test('sparse straight ground guides split into bounded windows without depending on polygon density', async () => {
    const targets: number[] = [];
    const builder: Parameters<typeof createWindowRoute>[0] = {
        query:  (_scene,_source,_start,_target,options) => {
            expect(options.corridor.tiles.length).toBeLessThanOrEqual(8);
            return Promise.resolve({status:'ready',message:'',output:groundPath,collision:'c'});
        },
        solve:  (_ground,local) => {
            targets.push(local.target[0]);
            return Promise.resolve({status:'ready',message:'',output:'r',collision:'c',result:{route:{
                status:'complete',start:local.arrival.id,arrivalCost:0,cost:1,
                length:Math.abs(local.target[0]-local.arrival.position[0]),points:[local.arrival.position,local.target],
                segments:[{mode:'walk',points:[local.arrival.position,local.target],times:[0,1]}],
            }}});
        },
    };
    const search = createWindowRoute(builder,request,[[0,0,0],[200,0,0]],settings);
    let result = await search.advance();
    for (let i=0;i<20 && result.status==='pending';i++) result=await search.advance();
    expect(result.status).toBe('complete');
    expect(targets.some(x=>x>0 && x<200)).toBe(true);
    expect(targets.at(-1)).toBe(200);
});

test('unknown airborne transfers cannot become invented grounded intermediate destinations', async () => {
    const builder: Parameters<typeof createWindowRoute>[0] = {
        query:  () => { throw new Error('An oversized action must not be grounded halfway'); },
        solve:  () => Promise.resolve(null),
    };
    const trajectory: [number,number,number][] = [[0,0,0],[200,0,0]];
    const search = createWindowRoute(builder,request,trajectory,{...settings,transfers:[trajectory]});
    const result = await search.advance();
    expect(result.status).toBe('incomplete');
    if (result.status==='incomplete') expect(result.reason).toBe('coverage-budget');
});

test('walking can replace an unnecessary device excursion across two solved windows', async () => {
    const builder: Parameters<typeof createWindowRoute>[0] = {
        query:  () => Promise.resolve(({ status:'ready',message:'',output:groundPath,collision:'collision' })),
        solve:  (_ground, local, _start, stage) => {
            if (stage === 'walking') return Promise.resolve({ status:'ready',message:'',output:'r',collision:'c',result:{reason:'no-verified-route'} });
            const start = local.arrival.position, exit = local.target;
            const a = [start[0]+1,start[1],0] as [number,number,number];
            const b = [exit[0]-1,exit[1],0] as [number,number,number];
            return Promise.resolve({ status:'ready',message:'',output:'r',collision:'c',result:{route:{
                status:'complete',start:local.arrival.id,arrivalCost:0,cost:102,length:120,
                points:[start,a,b,exit],segments:[
                    {mode:'walk',points:[start,a],times:[0,1]},
                    {mode:'launch',points:[a,b],times:[0,100],connection:'launcher'},
                    {mode:'walk',points:[b,exit],times:[0,1]},
                ],
            }} });
        },
    };
    const search = createWindowRoute(builder, {...request,target:[120,0,0]}, [[80,5,0],[120,0,0]], {...settings,maxTiles:8});
    let result = await search.advance();
    for (let i = 0; i < 12 && result.status === 'pending'; i++) result = await search.advance();
    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
        expect(result.evidence).toHaveLength(2);
        expect(result.route.points[0]).toEqual([0,0,0]);
        expect(result.route.points.at(-1)).toEqual([120,0,0]);
        expect(result.route.segments.every(s => s.mode === 'walk')).toBe(true);
        expect(result.route.cost).toBeCloseTo(24);
    }
});
