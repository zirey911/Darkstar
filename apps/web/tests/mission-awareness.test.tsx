import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import Terrain from '../app/terrain/page';
import {missionExamples} from '../app/terrain/mission-examples';
afterEach(()=>vi.unstubAllGlobals());
test('NASA example loads actual coordinates; evidence markers distinguish slopes, unknowns and objectives',async()=>{
 const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.endsWith('metadata'))return {ok:true,json:async()=>({provenance:{dataset:'MOLA fixture',elevation_datum:'areoid'},nominal_cell_m:3704})};
  if(url.endsWith('/inspect')){const p=JSON.parse(options!.body as string);return {ok:true,json:async()=>({cell_centre:p,slope_deg:p.lat===18.4446?20:null,routing_supported:p.lat===18.4446,nominal_cell_m:20,dataset:'Jezero CTX fixture',dataset_id:'jezero-ctx20'})};}
  return {ok:false,json:async()=>({detail:'Outbound route unavailable: Start exceeds the selected vehicle slope limit.'})};
 });
 vi.stubGlobal('fetch',fetcher);render(<Terrain/>);
 await screen.findByText(/MOLA fixture/);
 fireEvent.click(screen.getByRole('button',{name:'Marswalk'}));
 fireEvent.change(screen.getByLabelText('NASA landing-site mission'),{target:{value:'jezero'}});
 expect(screen.getByLabelText('Science objective')).toHaveValue(missionExamples[0].objective);
 const group=screen.getByRole('region',{name:'Pre-mission terrain assessment'});
 await within(group).findByText(/LIMIT EXCEEDED/);
 const map=screen.getByRole('img',{name:/Global Mars map/});
 const red=within(map).getAllByRole('button',{name:'Inspect Habitat: slope exceeds limit'}).find(e=>Number(e.querySelector('circle')!.getAttribute('cx'))>0)!;
 expect(red.querySelector('circle')).toHaveAttribute('stroke','#ff6868');
 expect(Number(red.querySelector('circle')!.getAttribute('cx'))).toBeCloseTo(77.4509);
 expect(within(map).getAllByRole('button',{name:'Inspect Science destination: local conditions unresolved'})[0].querySelector('circle')).toHaveAttribute('stroke','#f9d77e');
 expect(within(map).getAllByRole('button',{name:'Inspect Planned science objective'})[0].querySelector('circle')).toHaveAttribute('fill','#72e69b');
 fireEvent.click(red);
 expect(screen.getByRole('dialog',{name:'Mission marker evidence'})).toHaveTextContent('20.00°; configured limit 15°');
 fireEvent.click(screen.getByRole('button',{name:'Plan Marswalk'}));
 await screen.findByText('Outbound route unavailable: Start exceeds the selected vehicle slope limit.');
 expect(map.querySelector('polyline')).toBeNull();
 const body=JSON.parse(fetcher.mock.calls.find(([url])=>url.endsWith('/marswalk'))![1]!.body as string);
 expect(body.start).toEqual(missionExamples[0].start);expect(body.end).toEqual(missionExamples[0].end);
 fireEvent.change(screen.getByLabelText('NASA landing-site mission'),{target:{value:'gale'}});
 expect(screen.getByText(/Coarse planning only: MOLA/)).toBeVisible();
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Mission marker evidence'})).toBeNull());
});
