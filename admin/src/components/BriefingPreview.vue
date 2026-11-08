<template><div ref="host" style="height: 100%; width: 100%; overflow: hidden" /></template>
<script setup>
import { ref, watchEffect, onMounted, onBeforeUnmount } from 'vue';
import '../../../client/js/pig-looks.js';
import '../../../client/js/pig-3d.js';
import '../../../client/js/pig-greetings.js';
import '../../../client/js/briefing.js';
import '../../../client/css/briefing.css';
const props = defineProps({ kind: String, config: Object, news: Array });
const host = ref(null);
const samples = [
  ['news','场景预览 · 本地出行提醒','出行','地铁周末调整发车间隔，请为换乘预留时间。'],
  ['ranking','春季赏花路线引发关注','文旅','公园公布赏花地图，周末出游路线登上本地热搜。'],
  ['news','市图书馆延长周末开放时间','文化','周末闭馆时间延后至晚上八点，自习区同步开放。'],
  ['ranking','城市夜跑路线登上热搜','运动','沿江步道成为热门夜跑路线，晚间照明延长一小时。']
].map(([kind,title,topic,summary], i) => ({
  id: 'sample-' + i, kind, expires:Infinity,
  payload: {title,topic,summary,source:'预览样例',rank:kind === 'ranking' ? i : null}
}));
onBeforeUnmount(() => { window.HomeBriefing.disposeCards(host.value); window.HomeBriefing.disposePig(host.value); });
onMounted(() =>
  watchEffect(() => {
    const cfg = { ...props.config };
    if (props.kind === 'companion')
      window.HomeBriefing.pig(host.value, cfg, '出门记得带外套哦。', 'scarf');
    else
      window.HomeBriefing.cards(host.value, cfg, props.news?.length ? props.news : samples, Date.now());
  })
);
</script>
