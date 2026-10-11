import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import {fetchHistory} from '@/lib/api';
import type {PaginatedHistory} from '@/types/diagnosis';
import HistoryPage from './page';
vi.mock('@/lib/api',()=>({fetchHistory:vi.fn()}));
const fetchMock=vi.mocked(fetchHistory);
const response=(disease_name:string,crop_type:string):PaginatedHistory=>({
 items:[{id:disease_name,disease_name,crop_type,confidence:.9,created_at:'2026-10-10T00:00:00Z'}],
 total:21,unfiltered_total:21,crop_total:21,page:1,size:20,
});
beforeEach(()=>fetchMock.mockReset());
for(const change of ['crop','page']){
 it('hides previous results when a '+change+' request fails, then shows the retried results',async()=>{
  fetchMock.mockResolvedValueOnce(response('이전 진단','고추'))
   .mockRejectedValueOnce(new Error('조회 실패'))
   .mockResolvedValueOnce(response('새 진단','배추'));
  render(<HistoryPage/>);await screen.findByText('이전 진단');
  if(change==='crop')fireEvent.change(screen.getByRole('combobox',{name:'작물'}),{target:{value:'배추'}});
  else fireEvent.click(screen.getByRole('button',{name:'다음'}));
  await screen.findByRole('alert');
  expect(screen.queryByText('이전 진단')).toBeNull();
  expect(screen.queryByRole('navigation',{name:'이력 페이지'})).toBeNull();
  expect(screen.queryByText('선택한 조건의 기록이 없어요')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'다시 불러오기'}));
  await screen.findByText('새 진단');expect(screen.queryByRole('alert')).toBeNull();
  expect(fetchMock.mock.calls[2].slice(0,4)).toEqual(change==='crop'?[1,20,'배추',undefined]:[2,20,undefined,undefined]);
 });
}
