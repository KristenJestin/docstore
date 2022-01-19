namespace Docstore.Application.Models.DTO
{
    public class SearchFolderDto
    {
        public int Id { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string? Color { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
