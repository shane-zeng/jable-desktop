<script setup>
import { onMounted, ref } from 'vue';

defineProps({
  active: {
    type: Boolean,
    required: true
  }
});

var emit = defineEmits(['host']);
var browserHost = ref(null);

onMounted(function () {
  emit('host', browserHost.value);
});
</script>

<template>
  <section
    class="min-h-0 min-w-0 overflow-hidden bg-[var(--browser-bg)]"
    :class="active ? 'grid h-[calc(100vh-52px)] max-[1180px]:h-[calc(100vh-88px)]' : 'hidden'"
    aria-label="Jable browser"
  >
    <div
      ref="browserHost"
      class="block h-[calc(100vh-52px)] min-h-[calc(100vh-52px)] w-full max-[1180px]:h-[calc(100vh-88px)] max-[1180px]:min-h-[calc(100vh-88px)]"
    ></div>
  </section>
</template>
