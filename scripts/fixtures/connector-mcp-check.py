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
            async def call(name,args):
                result=await client.call_tool(name,args)
                assert not result.is_error, str(result.content)
                return result.structured_content
            read=await call('read_current_interview',{})
            missing=await call('prepare_continuation',{'snapshot':read['snapshot'],'rules':['删除填充，保留不确定和强调']})
            assert missing['needs_clarification']==['continuation_start']
            page=await call('read_interview_page',{'snapshot':read['snapshot']})
            assert page['segments'][0]['text']=='我觉得先开始。'
            plan=await call('prepare_continuation',{'snapshot':read['snapshot'],'start_id':'s2','rules':['删除填充，保留不确定和强调']})
            await call('stage_continuation',{'task_id':plan['task_id'],'changes':[{'segment_id':'s2','before':'嗯，我觉得可能还有问题。','after':'我觉得可能还有问题。'},{'segment_id':'s3','before':'这是很重要、很重要的。','after':'这是很重要、很重要的。'}]})
            result=await call('publish_continuation',{'task_id':plan['task_id'],'confirmed_summary':plan['summary']})
            assert result['saved'] and result['comparison_requested']
            again=await call('publish_continuation',{'task_id':plan['task_id'],'confirmed_summary':plan['summary']})
            assert result==again
            read=await call('read_current_interview',{})
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
            print('PASS: real MCP SDK -> HTTP broker -> actual App/useVersions/localStore -> new version and comparison requested; browser filesystem fixture; no real model call.')
asyncio.run(main())
