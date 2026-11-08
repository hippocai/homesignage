<template><details class="pig-rules"><summary>提醒、声音与免打扰</summary>
<el-form-item label="启用猪猪提醒"><el-switch v-model="value.enabled" /></el-form-item>
        <el-form-item label="允许朗读"><el-switch v-model="value.sound" /></el-form-item
        ><el-form-item label="音量"
          ><el-slider v-model="value.volume" :step="0.1" :max="1" style="width: 200px"
        /></el-form-item>
        <el-form-item label="时区"><el-input v-model="value.zone" /></el-form-item>
        <el-form-item label="免打扰时段"
          ><input type="time" v-model="value.quietFrom" /> 至 <input type="time" v-model="value.quietTo"
        /></el-form-item>
        <el-form-item label="最短间隔（分钟）"
          ><el-input-number v-model="value.gap" :min="0" :max="240"
        /></el-form-item>
        <el-form-item label="同一事项间隔">
          <el-input-number v-model="value.repeatMinutes" :min="1" :max="1440" /> 分钟
        </el-form-item>
        <el-form-item label="每条最多提醒">
          <el-input-number v-model="value.maxPlays" :min="1" :max="12" /> 次（含首次）
        </el-form-item>
        <el-form-item label="提醒类型">
          <el-checkbox v-model="value.family">家庭事项</el-checkbox>
          <el-checkbox v-model="value.cold">天气提醒（降温、降雨、官方预警）</el-checkbox>
          <el-checkbox v-model="value.news">影响家庭的资讯</el-checkbox>
        </el-form-item>
        <template v-if="value.cold"
          ><el-form-item label="城市"
            ><el-input v-model.trim="value.city" maxlength="80" placeholder="例如：深圳市" />
            <small>同名城市可填写「省份/城市」，例如「辽宁/朝阳市」。</small></el-form-item>
          <el-form-item label="温差（℃）"
            ><el-input-number v-model="value.threshold" :min="1" :max="30"
          /></el-form-item>
          <el-form-item label="日常出门时段"
            ><input type="time" v-model="value.from" /> 至
            <input type="time" v-model="value.to" /></el-form-item
          ><el-form-item label="仅周一至周五"><el-switch v-model="value.weekdays" /></el-form-item>
          <p>配置和风天气后，结合家庭资料、计划、未来7天及48小时预报和官方预警提前提醒。日常预报提前24小时，旅行可提前72小时；官方预警不受出门时段限制，仍遵守免打扰。未配置和风天气时沿用同城两天晨间预报的降温提醒。</p></template
        >
        <el-button @click="preview">预览提醒</el-button><p v-if="sample">{{ sample }}</p>
        <el-button v-if="sample && value.sound && value.enabled" link @click="listen">本机试听</el-button></details></template>
<script setup>
import {ref} from "vue";
import {ElMessage} from 'element-plus';
const props=defineProps({value:Object});const sample=ref("");
function preview(){const d=props.value;sample.value=!d.enabled?"提醒已关闭": [d.family&&"今晚八点停水，记得提前接水。",d.cold&&"今天降温，出门带外套。",d.news&&"你常走的道路有施工公告。"].filter(Boolean).join(" ") || "没有启用提醒类型";}
function listen(){if(!window.speechSynthesis)return ElMessage.info('此浏览器不支持朗读');const voice=new SpeechSynthesisUtterance(sample.value);
  voice.lang='zh-CN';voice.volume=props.value.volume;speechSynthesis.cancel();speechSynthesis.speak(voice);}
</script>
<style scoped>.pig-rules summary{cursor:pointer;margin:12px 0;font-weight:600}.pig-rules input[type=time]{max-width:100%}</style>
