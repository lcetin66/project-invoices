// Drag & Drop Datei-Upload
document.addEventListener('DOMContentLoaded', function() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadLabel = document.querySelector('.upload-text strong');
    const submitBtn = document.getElementById('submitBtn');

    if (dropZone && fileInput) {
        const setSelectedFileUI = (file) => {
            if (!file) return;
            if (uploadLabel) uploadLabel.textContent = file.name;
            if (submitBtn) submitBtn.style.display = '';
            if (window.appDebugLog) window.appDebugLog('ui.file.selected', { name: file.name, size: file.size, type: file.type });
        };

        // Keep the browser from opening dropped files in the tab.
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
            dropZone.addEventListener(eventName, function(e) {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Datei-Wahl nur im oberen Drop-Bereich auslösen (nicht auf Form-Controls unten)
        dropZone.addEventListener('click', function(e) {
            const isFormControl = e.target.closest('select, input, button, textarea, a, label');
            const inDropInner = e.target.closest('.upload-zone-inner');
            if (isFormControl) return;
            if (!inDropInner) return;
            if (e.target !== fileInput && !fileInput.contains(e.target)) fileInput.click();
        });

        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                setSelectedFileUI(this.files[0]);
            }
        });

        // Drag-Events
        dropZone.addEventListener('dragenter', function() {
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragover', function(e) {
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', function() {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', function(e) {
            dropZone.classList.remove('dragover');
            const droppedFiles = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : null;
            if (droppedFiles && droppedFiles.length > 0) {
                try {
                    // Some browsers are strict with direct FileList assignment.
                    const transfer = new DataTransfer();
                    for (let i = 0; i < droppedFiles.length; i++) {
                        transfer.items.add(droppedFiles[i]);
                    }
                    fileInput.files = transfer.files;
                } catch (_) {
                    try {
                        fileInput.files = droppedFiles;
                    } catch (_) {
                        // As a last resort, just update UI so user can pick file with click.
                    }
                }
                setSelectedFileUI(droppedFiles[0]);
            }
        });

        // Prevent accidental double-submit (double-click / slow network retries).
        dropZone.addEventListener('submit', function() {
            if (window.appDebugLog) window.appDebugLog('ui.form.submit', { form: 'dropZone' });
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.7';
            }
        });
    }

    // Kategorie-Filter
    const filterSelect = document.getElementById('filterKategorie');
    if (filterSelect) {
        filterSelect.addEventListener('change', function() {
            const cards = document.querySelectorAll('.rechnung-card');
            cards.forEach(card => {
                if (!this.value || card.dataset.kategorie === this.value) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    }

    // Seiten-Animationen
    document.querySelectorAll('.rechnung-card, .upload-section, .ergebnis-section').forEach(el => {
        el.classList.add('fade-in');
    });
});
