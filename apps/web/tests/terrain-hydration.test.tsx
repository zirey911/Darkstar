import {act} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {hydrateRoot} from 'react-dom/client';
import {expect,test,vi} from 'vitest';
import Terrain from '../app/terrain/page';

test('terrain server markup hydrates without replacing the SVG title or map',async()=>{
 const errors:unknown[]=[];
 const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const container=document.createElement('div');
 let root:ReturnType<typeof hydrateRoot>|undefined;
 try{
  container.innerHTML=renderToString(<Terrain/>);
  document.body.append(container);
  const serverMap=container.querySelector('svg.mars-map');
  const serverTitle=serverMap?.querySelector('title');
  const serverText=serverTitle?.textContent;
  await act(async()=>{root=hydrateRoot(container,<Terrain/>,{onRecoverableError:error=>errors.push(error)});});
  expect(errors.map(String)).toEqual([]);
  expect(consoleError.mock.calls).toEqual([]);
  expect(serverText).toBe('Mars colorized Viking with CTX detail (not natural color), equirectangular projection');
  expect(container.querySelector('svg.mars-map')).toBe(serverMap);
  expect(serverMap?.querySelector('title')).toBe(serverTitle);
  expect(serverTitle?.textContent).toBe(serverText);
 }finally{
  await act(async()=>root?.unmount());container.remove();consoleError.mockRestore();vi.unstubAllGlobals();
 }
});
