using AutoMapper;
using Docstore.Application.Interfaces;
using Docstore.Application.Models.DTO;
using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Controllers
{
    public class DataController : Controller
    {
        private readonly IFolderRepository _folderRepository;
        private readonly IMapper _mapper;

        public DataController(IFolderRepository folderRepository, IMapper mapper)
        {
            _folderRepository = folderRepository;
            _mapper = mapper;
        }

        public async Task<IActionResult> SearchFolder(string? term = null)
        {
            if (string.IsNullOrWhiteSpace(term))
                return Json(Enumerable.Empty<string>());

            var folders = await _folderRepository.SearchAsync(term);
            var dto = _mapper.Map<IEnumerable<SearchFolderDto>>(folders);

            return Json(dto);
        }
    }
}
