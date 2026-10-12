"""Synthetic protocol regression, used by connector-browser-check.mjs."""
import asyncio
import os
from pathlib import Path
from mcp import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

async def main():
    params=StdioServerParameters(command=os.path.abspath('backend/.venv/bin/python'),args=['-m','app.connector_mcp','--url',os.environ['RIPPLE_CONNECTOR_TEST_URL'],'--credential-file',str(Path(os.environ['RIPPLE_CONNECTOR_TEST_DIR']) / 'data/connector/client.key')],env={'PYTHONPATH':os.path.abspath('backend'),'PYTHONDONTWRITEBYTECODE':'1'})
    async with stdio_client(params) as (read,write):
        async with ClientSession(read,write) as client:
            await client.initialize()
            tools=(await client.list_tools()).tools
            assert len(tools)==13
            assert 'save_mode' in next(t for t in tools if t.name=='prepare_continuation').input_schema['properties']
            async def call(name,args):
                if name=='prepare_continuation':
                    args={'save_mode':'new_version',**args}
                result=await client.call_tool(name,args)
                assert not result.is_error, str(result.content)
                return result.structured_content
            if os.environ.get('RIPPLE_DELETE_BETWEEN_ONLY')=='1':
                read=await call('read_current_interview',{})
                page=await call('read_interview_page',{'snapshot':read['snapshot']})
                assert len(page['segments'])==3 and page['segments'][1]['text']=='嗯'
                plan=await call('prepare_continuation',{'snapshot':read['snapshot'],'start_id':'s1',
                    'rules':['Synthetic: delete the filler, then merge the remaining same-speaker neighbors'],
                    'save_mode':os.environ.get('RIPPLE_SAVE_MODE','new_version'),
                    'allowed_actions':['edit','merge_previous','delete']})
                await call('stage_continuation',{'task_id':plan['task_id'],'changes':[
                    {'segment_id':'s2','before':'嗯','after':'','action':'delete'}]})
                await call('stage_continuation',{'task_id':plan['task_id'],'changes':[
                    {'segment_id':s['id'],'before':s['text'],'after':s['text'],
                     'action':'merge_previous' if s['id']=='s3' else 'edit'}
                    for s in reversed(page['segments']) if s['id']!='s2']})
                args={'task_id':plan['task_id'],'confirmed_summary':plan['summary']}
                if os.environ.get('RIPPLE_EXPECT_SAVE_FAILURE')=='1':
                    failed=await client.call_tool('publish_continuation',args)
                    assert failed.is_error and 'current_version_save_failed_changes_retained_in_ripple' in str(failed.content)
                    status=await call('continuation_status',{'task_id':plan['task_id']})
                    assert status['state']=='draft' and status['result'] is None
                    print('PASS: current-version failed save was reported as failure, not saved success.')
                    return
                saved=await call('publish_continuation',args)
                assert saved['saved'] and saved['deleted_segments']==1 and saved['merged_segments']==1
                assert saved['new_version_created']==(os.environ.get('RIPPLE_SAVE_MODE')!='current_version')
                if os.environ.get('RIPPLE_SAVE_MODE')=='current_version':
                    assert saved['result_version']==read['current_version']
                assert await call('publish_continuation',args)==saved
                final=await call('read_current_interview',{})
                assert final['segment_count']==1
                final_page=await call('read_interview_page',{'snapshot':final['snapshot']})
                assert final_page['segments'][0]['text']==page['segments'][0]['text']+'\n'+page['segments'][2]['text']
                print('PASS: real MCP deletes intervening filler first, merges retained same-speaker neighbors and publishes once.')
                return
            if os.environ.get('RIPPLE_STRUCTURAL_ONLY')=='1':
                read=await call('read_current_interview',{})
                page=await call('read_interview_page',{'snapshot':read['snapshot']})
                structural=await call('prepare_continuation',{'snapshot':read['snapshot'],'start_id':'s1',
                    'rules':['Synthetic: merge adjacent same-speaker segments and remove the final filler segment'],
                    'allowed_actions':['edit','merge_previous','delete']})
                await call('stage_continuation',{'task_id':structural['task_id'],'changes':[
                    {'segment_id':s['id'],'before':s['text'],'after':'' if s['id']=='s3' else s['text'],
                     'action':'delete' if s['id']=='s3' else 'merge_previous' if s['id']=='s2' else 'edit'}
                    for s in reversed(page['segments'])]})
                saved=await call('publish_continuation',{'task_id':structural['task_id'],'confirmed_summary':structural['summary']})
                assert saved['saved'] and saved['merged_segments']==1 and saved['deleted_segments']==1
                assert await call('publish_continuation',{'task_id':structural['task_id'],'confirmed_summary':structural['summary']})==saved
                final=await call('read_current_interview',{})
                assert final['segment_count']==1
                final_page=await call('read_interview_page',{'snapshot':final['snapshot']})
                assert final_page['segments'][0]['id']=='s1'
                assert final_page['segments'][0]['text']==page['segments'][0]['text']+'\n'+page['segments'][1]['text']
                print('PASS: real MCP structural operations saved one new version, repeated publish idempotent.')
                return
            read=await call('read_current_interview',{})
            examples=await call('read_editing_examples',{'snapshot':read['snapshot'],'segment_ids':['s1']})
            assert examples['comparison_status']=='resolved'
            assert examples['comparison']['before_version']['kind']=='original'
            assert examples['comparison']['after_version']==read['current_version']
            assert examples['examples'][0]['before']=='嗯，我觉得先开始，把这份合成稿件核对清楚。'
            assert examples['examples'][0]['after']=='我觉得先开始，把这份合成稿件核对清楚。'
            missing=await call('prepare_continuation',{'snapshot':read['snapshot'],'rules':['删除填充，保留不确定和强调']})
            assert missing['needs_clarification']==['continuation_start']
            page=await call('read_interview_page',{'snapshot':read['snapshot']})
            assert page['segments'][0]['text']=='我觉得先开始，把这份合成稿件核对清楚。'
            plan=await call('prepare_continuation',{'snapshot':read['snapshot'],'start_id':'s2','rules':['删除填充，保留不确定和强调']})
            await call('stage_continuation',{'task_id':plan['task_id'],'changes':[{'segment_id':'s2','before':'嗯，我觉得可能还有问题，需要继续检查这个合成例子。','after':'我觉得可能还有问题，需要继续检查这个合成例子。'},{'segment_id':'s3','before':'这是很重要、很重要的。','after':'这是很重要、很重要的。'}]})
            result=await call('publish_continuation',{'task_id':plan['task_id'],'confirmed_summary':plan['summary']})
            assert result['saved'] and result['comparison_requested']
            again=await call('publish_continuation',{'task_id':plan['task_id'],'confirmed_summary':plan['summary']})
            assert result==again
            read=await call('read_current_interview',{})
            candidates=await call('read_editing_examples',{'snapshot':read['snapshot'],'segment_ids':[]})
            assert candidates['comparison_status']=='selection_required'
            assert candidates['examples']==[]
            baseline=next(v for v in candidates['comparison_versions'] if v['edit_id']=='e1')
            compared=await call('read_editing_examples',{'snapshot':read['snapshot'],'segment_ids':['s2'],
                                                        'comparison_version_id':baseline['id']})
            assert compared['comparison']['before_version']==baseline
            assert compared['comparison']['after_version']==read['current_version']
            assert compared['examples'][0]['before']=='嗯，我觉得可能还有问题，需要继续检查这个合成例子。'
            assert compared['examples'][0]['after']=='我觉得可能还有问题，需要继续检查这个合成例子。'
            page=await call('read_interview_page',{'snapshot':read['snapshot']})
            marks=await call('prepare_interview_marks',{'snapshot':read['snapshot'],'whole_interview':True,'instructions':'添加合成分析批注，高亮可能'})
            await call('stage_interview_marks',{'task_id':marks['task_id'],'marks':[
                {'segment_id':segment['id'],'before':segment['text'],
                 'annotation':'合成 AI 分析' if segment['id']=='s2' else None,
                 'highlights':[{'start':3,'end':5,'text':'可能'}] if segment['id']=='s2' else []}
                for segment in page['segments']]})
            marked=await call('apply_interview_marks',{'task_id':marks['task_id'],'confirmed_summary':marks['summary']})
            assert marked['saved'] and not marked['new_version_created']
            assert marked['added_annotations']==1 and marked['added_highlights']==1
            assert marked['version_id']==result['version_id']
            assert await call('apply_interview_marks',{'task_id':marks['task_id'],'confirmed_summary':marks['summary']})==marked
            print('PASS: real MCP SDK -> HTTP broker -> App/localStore -> automatic sole original, explicit edit comparison after candidate selection, continuation and marks; synthetic browser filesystem; no real model call.')
asyncio.run(main())
