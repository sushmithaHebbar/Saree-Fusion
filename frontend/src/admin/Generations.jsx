import GenerationGallery from './GenerationGallery.jsx';

export default function Generations() {
  return (
    <>
      <h1 className="ad-h1">Generations</h1>
      <p className="ad-muted small">Every design run: the swatches each weaver uploaded and what was generated. Open a card to compare them side by side.</p>
      <GenerationGallery />
    </>
  );
}
