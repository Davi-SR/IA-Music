const cursor = document.querySelector("#cursor");

if (cursor) {
  document.addEventListener("mousemove", (event) => {
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
  });

  document.addEventListener("mouseover", (event) => {
    if (event.target.closest("a, button, label, summary, [role='button']")) {
      cursor.classList.add("hovered");
    }
  });

  document.addEventListener("mouseout", (event) => {
    if (event.target.closest("a, button, label, summary, [role='button']")) {
      cursor.classList.remove("hovered");
    }
  });
}

