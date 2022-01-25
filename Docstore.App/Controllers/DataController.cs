using AutoMapper;
using Docstore.App.Models.Forms;
using Docstore.Application.Interfaces;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Controllers
{
    public class DataController : Controller
    {
        private readonly IFolderRepository _folderRepository;
        private readonly IMapper _mapper;
        private readonly AppDbContext _db;

        public DataController(IMapper mapper, IFolderRepository folderRepository, AppDbContext db)
        {
            _folderRepository = folderRepository;
            _mapper = mapper;
            _db = db;
        }

        public async Task<IActionResult> FolderSearch(string? term = null)
        {
            if (string.IsNullOrWhiteSpace(term))
                return Json(Enumerable.Empty<string>());

            var folders = await _folderRepository.SearchAsync(term);
            var dto = _mapper.Map<IEnumerable<GetFolderDto>>(folders);

            return Json(dto);
        }
    }
}
